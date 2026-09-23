package acceptance_test

import (
	"bytes"
	"context"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/cucumber/godog"
	"github.com/go-chi/chi/v5"

	"github.com/nathangalung/internalgns/apps/api/internal/clients"
	"github.com/nathangalung/internalgns/apps/api/internal/invoices"
	"github.com/nathangalung/internalgns/apps/api/internal/purchaseorders"
	"github.com/nathangalung/internalgns/apps/api/internal/quotations"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/deps"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

const (
	defaultUserID  int64 = 1
	defaultCompany int64 = 1
	defaultUnit    int16 = 19

	offeredName = "ACCEPTANCE VALVE SNAPSHOT"
	offeredCode = "A58001"
	renamedName = "ACCEPTANCE VALVE RENAMED"
	renamedCode = "A58002"
)

type scenarioState struct {
	t           *testing.T
	srv         *httptest.Server
	last        *http.Response
	body        []byte
	userID      int64
	quotationID int64
	poID        int64
	invoiceID   int64
	cleaner     *testutil.Cleaner
	itemID      int64
}

func (s *scenarioState) reset() error {
	pool := testutil.Pool(s.t)
	return testutil.ResetCommercialDomain(context.Background(), pool)
}

func (s *scenarioState) sendRequest(method, path string, body any) error {
	return s.sendRequestWithHeaders(method, path, body, nil)
}

func (s *scenarioState) sendRequestWithHeaders(method, path string, body any, headers map[string]string) error {
	var rdr io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			return err
		}
		rdr = bytes.NewReader(raw)
	}
	req, err := http.NewRequest(method, s.srv.URL+path, rdr)
	if err != nil {
		return err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	res, err := s.srv.Client().Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	raw, err := io.ReadAll(res.Body)
	if err != nil {
		return err
	}
	s.last = res
	s.body = raw
	return nil
}

func (s *scenarioState) authenticatedUser(id int64) error {
	s.userID = id
	s.srv = testutil.FullServer(s.t, id)
	return nil
}

func (s *scenarioState) emptyDomain() error { return s.reset() }

// Walk quotation to delivered PO, materialize invoice.
func (s *scenarioState) deliveredPurchaseOrder() error {
	return s.deliverLine(quotations.CreateItem{
		RequestedName: "Test Product",
		Qty:           "2",
		UnitID:        defaultUnit,
		SellingPrice:  "100000",
	})
}

// Deliver a line offering a catalog item.
func (s *scenarioState) deliveredOfferedPurchaseOrder() error {
	err := testutil.Pool(s.t).QueryRow(context.Background(),
		`INSERT INTO items (name, impa_code, default_unit_id, created_by, updated_by)
		 VALUES ($1, $2, $3, $4, $4) RETURNING id`,
		offeredName, offeredCode, defaultUnit, defaultUserID,
	).Scan(&s.itemID)
	if err != nil {
		return fmt.Errorf("create offered item: %w", err)
	}
	s.cleaner.Item(s.itemID)
	offered := s.itemID
	return s.deliverLine(quotations.CreateItem{
		RequestedName: "valve 2 inch pls check",
		OfferedItemID: &offered,
		Qty:           "1",
		UnitID:        defaultUnit,
		SellingPrice:  "100000",
	})
}

// Deliver one line to an invoice.
func (s *scenarioState) deliverLine(line quotations.CreateItem) error {
	create := quotations.CreateRequest{
		CompanyClientID: defaultCompany,
		DiscountPct:     "0",
		Items:           []quotations.CreateItem{line},
	}
	if err := s.sendRequest(http.MethodPost, "/quotations/", create); err != nil {
		return err
	}
	if s.last.StatusCode != http.StatusCreated {
		return fmt.Errorf("create want 201 got %d body=%s", s.last.StatusCode, s.body)
	}
	var resp map[string]int64
	if err := json.Unmarshal(s.body, &resp); err != nil {
		return err
	}
	s.quotationID = resp["id"]

	if err := s.sendRequest(http.MethodPost, "/quotations/"+strconv.FormatInt(s.quotationID, 10)+"/send", nil); err != nil {
		return err
	}
	if s.last.StatusCode != http.StatusNoContent {
		return fmt.Errorf("send want 204 got %d body=%s", s.last.StatusCode, s.body)
	}
	if err := s.sendRequest(http.MethodPatch, "/quotations/"+strconv.FormatInt(s.quotationID, 10)+"/status", quotations.ChangeStatusRequest{Status: "accepted"}); err != nil {
		return err
	}
	if s.last.StatusCode != http.StatusNoContent {
		return fmt.Errorf("accept want 204 got %d body=%s", s.last.StatusCode, s.body)
	}

	if err := s.sendRequest(http.MethodGet, "/purchase-orders/by-quotation/"+strconv.FormatInt(s.quotationID, 10), nil); err != nil {
		return err
	}
	if s.last.StatusCode != http.StatusOK {
		return fmt.Errorf("po fetch want 200 got %d body=%s", s.last.StatusCode, s.body)
	}
	var po purchaseorders.PurchaseOrder
	if err := json.Unmarshal(s.body, &po); err != nil {
		return err
	}
	s.poID = po.ID

	for _, target := range []purchaseorders.Status{purchaseorders.StatusUploaded, purchaseorders.StatusOnProgress, purchaseorders.StatusDelivered} {
		if err := s.sendRequest(http.MethodPatch, "/purchase-orders/"+strconv.FormatInt(s.poID, 10)+"/status", purchaseorders.ChangeStatusRequest{Status: target}); err != nil {
			return err
		}
		if s.last.StatusCode != http.StatusNoContent {
			return fmt.Errorf("po -> %s want 204 got %d body=%s", target, s.last.StatusCode, s.body)
		}
	}

	if err := s.readInvoiceByQuotation(); err != nil {
		return err
	}
	if s.last.StatusCode != http.StatusOK {
		return fmt.Errorf("invoice fetch want 200 got %d body=%s", s.last.StatusCode, s.body)
	}
	var inv invoices.Invoice
	if err := json.Unmarshal(s.body, &inv); err != nil {
		return err
	}
	s.invoiceID = inv.ID
	return nil
}

func (s *scenarioState) readInvoiceByQuotation() error {
	return s.sendRequest(http.MethodGet, "/invoices/by-quotation/"+strconv.FormatInt(s.quotationID, 10), nil)
}

func (s *scenarioState) listInvoiceItems() error {
	return s.sendRequest(http.MethodGet, "/invoices/"+strconv.FormatInt(s.invoiceID, 10)+"/items", nil)
}

func (s *scenarioState) listInvoicesByStatus(status string) error {
	return s.sendRequest(http.MethodGet, "/invoices/?status="+status, nil)
}

func (s *scenarioState) readSummary() error {
	return s.sendRequest(http.MethodGet, "/invoices/summary", nil)
}

func (s *scenarioState) statusEquals(want int) error {
	if s.last.StatusCode != want {
		return fmt.Errorf("want %d got %d body=%s", want, s.last.StatusCode, s.body)
	}
	return nil
}

func (s *scenarioState) invoiceStatusEquals(want string) error {
	var inv invoices.Invoice
	if err := json.Unmarshal(s.body, &inv); err != nil {
		return err
	}
	if string(inv.Status) != want {
		return fmt.Errorf("want %s got %s", want, inv.Status)
	}
	return nil
}

// The invoice screen runs on finance credentials, which cannot read
// quotations or purchase orders, so the header must arrive from here.
func (s *scenarioState) invoiceDetailCarriesHeader() error {
	var det invoices.InvoiceDetail
	if err := json.Unmarshal(s.body, &det); err != nil {
		return err
	}
	missing := []string{}
	if strings.TrimSpace(det.QuotationNo) == "" {
		missing = append(missing, "quotationNo")
	}
	if strings.TrimSpace(det.CompanyName) == "" {
		missing = append(missing, "companyName")
	}
	if det.CompanyNpwp == nil || strings.TrimSpace(*det.CompanyNpwp) == "" {
		missing = append(missing, "companyNpwp")
	}
	if det.CompanyAddress == nil || strings.TrimSpace(*det.CompanyAddress) == "" {
		missing = append(missing, "companyAddress")
	}
	if det.ContactName == nil || strings.TrimSpace(*det.ContactName) == "" {
		missing = append(missing, "contactName")
	}
	if det.PoNumber == nil || strings.TrimSpace(*det.PoNumber) == "" {
		missing = append(missing, "poNumber")
	}
	if det.PoDate == nil {
		missing = append(missing, "poDate")
	}
	if len(missing) > 0 {
		return fmt.Errorf("invoice detail missing %s", strings.Join(missing, ", "))
	}
	return nil
}

func (s *scenarioState) invoiceDetailOffersTransitions() error {
	var det invoices.InvoiceDetail
	if err := json.Unmarshal(s.body, &det); err != nil {
		return err
	}
	want := invoices.AllowedTransitions(det.Status)
	if len(want) != len(det.AllowedStatuses) {
		return fmt.Errorf("want %v got %v", want, det.AllowedStatuses)
	}
	for i, st := range want {
		if det.AllowedStatuses[i] != st {
			return fmt.Errorf("want %v got %v", want, det.AllowedStatuses)
		}
	}
	return nil
}

func (s *scenarioState) replaceInvoice() error {
	return s.sendRequest(http.MethodPost, "/invoices/"+strconv.FormatInt(s.invoiceID, 10)+"/replacement", nil)
}

// The replacement is a new Pengganti invoice linked to the cancelled one.
func (s *scenarioState) invoiceIsPengganti() error {
	var det invoices.InvoiceDetail
	if err := json.Unmarshal(s.body, &det); err != nil {
		return err
	}
	if det.ID == s.invoiceID {
		return fmt.Errorf("by-quotation still returns the cancelled invoice %d", det.ID)
	}
	if det.FakturType == nil || *det.FakturType != "Pengganti" {
		return fmt.Errorf("want faktur type Pengganti got %v", det.FakturType)
	}
	if det.ReplacesInvoiceID == nil || *det.ReplacesInvoiceID != s.invoiceID {
		return fmt.Errorf("want replacesInvoiceId %d got %v", s.invoiceID, det.ReplacesInvoiceID)
	}
	return nil
}

func (s *scenarioState) invoiceNumberSet() error {
	var inv invoices.Invoice
	if err := json.Unmarshal(s.body, &inv); err != nil {
		return err
	}
	if strings.TrimSpace(inv.InvoiceNo) == "" {
		return fmt.Errorf("invoice number empty")
	}
	return nil
}

func (s *scenarioState) invoicePositiveTotal() error {
	var inv invoices.Invoice
	if err := json.Unmarshal(s.body, &inv); err != nil {
		return err
	}
	if inv.Total == nil {
		return fmt.Errorf("total missing")
	}
	v, err := strconv.ParseFloat(*inv.Total, 64)
	if err != nil {
		return err
	}
	if v <= 0 {
		return fmt.Errorf("want >0 got %v", v)
	}
	return nil
}

func (s *scenarioState) invoiceItemsAtLeastProducts(min int) error {
	var rows []invoices.InvoiceItem
	if err := json.Unmarshal(s.body, &rows); err != nil {
		return err
	}
	count := 0
	for _, it := range rows {
		if it.LineType == "product" {
			count++
		}
	}
	if count < min {
		return fmt.Errorf("want >=%d products got %d", min, count)
	}
	return nil
}

func (s *scenarioState) invoiceListAtLeast(min int) error {
	var rows []invoices.Invoice
	if err := json.Unmarshal(s.body, &rows); err != nil {
		return err
	}
	if len(rows) < min {
		return fmt.Errorf("want >=%d rows got %d", min, len(rows))
	}
	return nil
}

func (s *scenarioState) walkInvoicePath(path string) error {
	for _, step := range strings.Split(path, ",") {
		if err := s.transitionInvoiceTo(strings.TrimSpace(step)); err != nil {
			return err
		}
		if s.last.StatusCode != http.StatusNoContent {
			return fmt.Errorf("step %s wanted 204 got %d body=%s", step, s.last.StatusCode, s.body)
		}
	}
	return nil
}

func (s *scenarioState) transitionInvoiceTo(target string) error {
	body := invoices.ChangeStatusRequest{Status: invoices.Status(target)}
	return s.sendRequest(http.MethodPatch, "/invoices/"+strconv.FormatInt(s.invoiceID, 10)+"/status", body)
}

func (s *scenarioState) tryInvoiceTransition(target string) error {
	return s.transitionInvoiceTo(target)
}

func (s *scenarioState) lastTransitionSucceeds() error {
	if s.last.StatusCode != http.StatusNoContent {
		return fmt.Errorf("last not 204: %d body=%s", s.last.StatusCode, s.body)
	}
	return nil
}

func (s *scenarioState) updateInvoiceDueDate(date string) error {
	if err := s.readInvoiceByQuotation(); err != nil {
		return err
	}
	var inv invoices.Invoice
	if err := json.Unmarshal(s.body, &inv); err != nil {
		return err
	}
	body := map[string]string{"dueDate": date + "T00:00:00Z"}
	return s.sendRequestWithHeaders(
		http.MethodPatch,
		"/invoices/"+strconv.FormatInt(s.invoiceID, 10)+"/dates",
		body,
		map[string]string{"If-Match": strconv.FormatInt(int64(inv.RowVersion), 10)},
	)
}

func (s *scenarioState) summaryTotalAtLeast(min int64) error {
	var sum invoices.Summary
	if err := json.Unmarshal(s.body, &sum); err != nil {
		return err
	}
	if sum.Total < min {
		return fmt.Errorf("want >=%d got %d", min, sum.Total)
	}
	return nil
}

func (s *scenarioState) summaryBucketsConsistent() error {
	var sum invoices.Summary
	if err := json.Unmarshal(s.body, &sum); err != nil {
		return err
	}
	got := sum.Draft + sum.Sent + sum.Paid + sum.Overdue
	if sum.Total != got {
		return fmt.Errorf("total %d != buckets %d", sum.Total, got)
	}
	return nil
}

func (s *scenarioState) renameOfferedItem() error {
	_, err := testutil.Pool(s.t).Exec(context.Background(),
		`UPDATE items SET name = $2, impa_code = $3 WHERE id = $1`,
		s.itemID, renamedName, renamedCode)
	if err != nil {
		return fmt.Errorf("rename offered item: %w", err)
	}
	return nil
}

func (s *scenarioState) invoiceItemsNameIssuedItem() error {
	var rows []invoices.InvoiceItem
	if err := json.Unmarshal(s.body, &rows); err != nil {
		return err
	}
	if len(rows) == 0 {
		return fmt.Errorf("no invoice items body=%s", s.body)
	}
	got := rows[0]
	if got.ItemName != offeredName || got.ItemCode == nil || *got.ItemCode != offeredCode {
		return fmt.Errorf("want %s/%s got %s/%v", offeredName, offeredCode, got.ItemName, got.ItemCode)
	}
	return nil
}

type coretaxGood struct {
	Code string `xml:"Code"`
	Name string `xml:"Name"`
}

// FullServer carries no seller identity.
func (s *scenarioState) coretaxServer() *httptest.Server {
	pool := testutil.Pool(s.t)
	store := testutil.Store(s.t)
	h := invoices.NewCoretaxHandler(
		invoices.NewRepo(pool, store), clients.NewRepo(pool, store),
		deps.CoretaxSettings{SellerTIN: "9999999999999999", SellerIDTKU: "9999999999999999000000"}, "")
	r := chi.NewRouter()
	r.Get("/invoices/{id}/coretax.xml", h.Export)
	srv := httptest.NewServer(r)
	s.t.Cleanup(srv.Close)
	return srv
}

func (s *scenarioState) coretaxNamesIssuedItem() error {
	srv := s.coretaxServer()
	res, err := srv.Client().Get(srv.URL + "/invoices/" + strconv.FormatInt(s.invoiceID, 10) + "/coretax.xml")
	if err != nil {
		return err
	}
	defer res.Body.Close()
	raw, err := io.ReadAll(res.Body)
	if err != nil {
		return err
	}
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("coretax want 200 got %d body=%s", res.StatusCode, raw)
	}
	var doc struct {
		Goods []coretaxGood `xml:"ListOfTaxInvoice>TaxInvoice>ListOfGoodService>GoodService"`
	}
	if err := xml.Unmarshal(raw, &doc); err != nil {
		return err
	}
	want := coretaxGood{Code: offeredCode, Name: offeredName}
	if len(doc.Goods) != 1 || doc.Goods[0] != want {
		return fmt.Errorf("want %+v got %+v", want, doc.Goods)
	}
	return nil
}

func initScenario(t *testing.T, cleaner *testutil.Cleaner) func(*godog.ScenarioContext) {
	return func(sc *godog.ScenarioContext) {
		state := &scenarioState{t: t, userID: defaultUserID, cleaner: cleaner}
		sc.Before(func(ctx context.Context, _ *godog.Scenario) (context.Context, error) {
			state.last = nil
			state.body = nil
			state.quotationID = 0
			state.poID = 0
			state.invoiceID = 0
			state.itemID = 0
			return ctx, nil
		})
		// Free the item for the cleaner.
		sc.After(func(ctx context.Context, _ *godog.Scenario, _ error) (context.Context, error) {
			if state.itemID == 0 {
				return ctx, nil
			}
			if err := state.reset(); err != nil {
				return ctx, fmt.Errorf("free offered item: %w", err)
			}
			return ctx, nil
		})

		sc.Step(`^an authenticated user with id (\d+)$`, func(id int64) error { return state.authenticatedUser(id) })
		sc.Step(`^the commercial domain is empty$`, state.emptyDomain)
		sc.Step(`^a delivered purchase order$`, state.deliveredPurchaseOrder)
		sc.Step(`^a delivered purchase order offering a catalog item$`, state.deliveredOfferedPurchaseOrder)
		sc.Step(`^the offered catalog item is renamed$`, state.renameOfferedItem)
		sc.Step(`^the invoice items name the offered item as issued$`, state.invoiceItemsNameIssuedItem)
		sc.Step(`^the Coretax export names the offered item as issued$`, state.coretaxNamesIssuedItem)
		sc.Step(`^the user reads the invoice by quotation$`, state.readInvoiceByQuotation)
		sc.Step(`^the user lists invoice items$`, state.listInvoiceItems)
		sc.Step(`^the user lists invoices filtered by status "([^"]+)"$`, state.listInvoicesByStatus)
		sc.Step(`^the user reads the invoice summary$`, state.readSummary)
		sc.Step(`^the user updates invoice due date to "([^"]+)"$`, state.updateInvoiceDueDate)
		sc.Step(`^the user transitions the invoice through "([^"]+)"$`, state.walkInvoicePath)
		sc.Step(`^every invoice transition succeeds$`, state.lastTransitionSucceeds)
		sc.Step(`^the user tries to transition the invoice to "([^"]+)"$`, state.tryInvoiceTransition)
		sc.Step(`^the response status is (\d+)$`, state.statusEquals)
		sc.Step(`^the invoice status is "([^"]+)"$`, state.invoiceStatusEquals)
		sc.Step(`^the invoice number is set$`, state.invoiceNumberSet)
		sc.Step(`^the invoice detail carries the client and purchase order header$`, state.invoiceDetailCarriesHeader)
		sc.Step(`^the invoice detail offers the transitions the database allows$`, state.invoiceDetailOffersTransitions)
		sc.Step(`^the invoice has positive total$`, state.invoicePositiveTotal)
		sc.Step(`^the user replaces the invoice$`, state.replaceInvoice)
		sc.Step(`^the invoice is the Pengganti of the cancelled invoice$`, state.invoiceIsPengganti)
		sc.Step(`^the invoice items contain at least (\d+) product line(?:s)?$`, state.invoiceItemsAtLeastProducts)
		sc.Step(`^the invoice list contains at least (\d+) row(?:s)?$`, state.invoiceListAtLeast)
		sc.Step(`^the invoice summary total is at least (\d+)$`, state.summaryTotalAtLeast)
		sc.Step(`^the invoice summary buckets sum to total$`, state.summaryBucketsConsistent)
	}
}

func TestInvoiceFeatures(t *testing.T) {
	testutil.RequireDB(t)
	cleaner := testutil.NewCleaner(t)
	suite := godog.TestSuite{
		ScenarioInitializer: initScenario(t, cleaner),
		Options: &godog.Options{
			Format:   "pretty",
			Paths:    []string{"features"},
			TestingT: t,
		},
	}
	if status := suite.Run(); status != 0 {
		t.Fatalf("godog suite failed status=%d", status)
	}
}
