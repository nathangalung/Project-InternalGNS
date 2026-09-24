package acceptance_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/cucumber/godog"

	"github.com/nathangalung/internalgns/apps/api/internal/invoices"
	"github.com/nathangalung/internalgns/apps/api/internal/purchaseorders"
	"github.com/nathangalung/internalgns/apps/api/internal/quotations"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

const (
	defaultUserID     int64 = 1
	defaultCompany    int64 = 1
	incompleteCompany int64 = 2
	defaultUnit       int16 = 19
)

type scenarioState struct {
	t           *testing.T
	srv         *httptest.Server
	last        *http.Response
	body        []byte
	userID      int64
	quotationID int64
	poID        int64
	// Delivery note routes need templates, which FullServer omits.
	dnSrv    *httptest.Server
	dnNumber string
	// Role scenarios run on the production router.
	appSrv    *httptest.Server
	cleaner   *testutil.Cleaner
	roleToken string
	roleUsed  bool
}

func (s *scenarioState) reset() error {
	pool := testutil.Pool(s.t)
	return testutil.ResetCommercialDomain(context.Background(), pool)
}

func (s *scenarioState) sendRequest(method, path string, body any) error {
	return s.sendRequestWithHeaders(method, path, body, nil)
}

func (s *scenarioState) sendRequestWithHeaders(
	method, path string, body any, headers map[string]string,
) error {
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

// Drive quotation to accepted, PO auto-created.
func (s *scenarioState) acceptedQuotation() error {
	return s.acceptedQuotationForCompany(defaultCompany)
}

// Company 2 in the master seed has no NPWP, address or contact.
func (s *scenarioState) acceptedQuotationIncompleteClient() error {
	return s.acceptedQuotationForCompany(incompleteCompany)
}

func (s *scenarioState) acceptedQuotationForCompany(companyID int64) error {
	return s.acceptedQuotationWith(companyID, quotations.CreateItem{
		RequestedName: "Test Product",
		Qty:           "2",
		UnitID:        defaultUnit,
		SellingPrice:  "100000",
	})
}

func (s *scenarioState) acceptedQuotationWith(companyID int64, item quotations.CreateItem) error {
	create := quotations.CreateRequest{
		CompanyClientID: companyID,
		DiscountPct:     "0",
		Items:           []quotations.CreateItem{item},
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
	// Registered before the PO exists, so a failed accept still cleans up.
	s.cleaner.Quotation(s.quotationID)

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

	if err := s.readPOByQuotation(); err != nil {
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
	return nil
}

func (s *scenarioState) readPOByQuotation() error {
	return s.sendRequest(http.MethodGet, "/purchase-orders/by-quotation/"+strconv.FormatInt(s.quotationID, 10), nil)
}

func (s *scenarioState) readInvoiceByQuotation() error {
	return s.sendRequest(http.MethodGet, "/invoices/by-quotation/"+strconv.FormatInt(s.quotationID, 10), nil)
}

func (s *scenarioState) listPOItems() error {
	return s.sendRequest(http.MethodGet, "/purchase-orders/"+strconv.FormatInt(s.poID, 10)+"/items", nil)
}

func (s *scenarioState) listPOsByStatus(status string) error {
	return s.sendRequest(http.MethodGet, "/purchase-orders/?status="+status, nil)
}

func (s *scenarioState) statusEquals(want int) error {
	if s.last.StatusCode != want {
		return fmt.Errorf("want %d got %d body=%s", want, s.last.StatusCode, s.body)
	}
	return nil
}

func (s *scenarioState) poDetailStatusEquals(want string) error {
	var po purchaseorders.PurchaseOrder
	if err := json.Unmarshal(s.body, &po); err != nil {
		return err
	}
	if string(po.Status) != want {
		return fmt.Errorf("want %s got %s", want, po.Status)
	}
	return nil
}

func (s *scenarioState) poNumberSet() error {
	var po purchaseorders.PurchaseOrder
	if err := json.Unmarshal(s.body, &po); err != nil {
		return err
	}
	if strings.TrimSpace(po.PoNumber) == "" {
		return fmt.Errorf("po number empty")
	}
	return nil
}

func (s *scenarioState) poDiscountEquals(want string) error {
	var po purchaseorders.PurchaseOrder
	if err := json.Unmarshal(s.body, &po); err != nil {
		return err
	}
	if !numericEquals(po.DiscountPct, want) {
		return fmt.Errorf("want discount %s got %s", want, po.DiscountPct)
	}
	return nil
}

// PO-05: the PO read model must agree with the invoice it produced.
func (s *scenarioState) poTotalsEqualInvoice() error {
	var po purchaseorders.PurchaseOrder
	if err := json.Unmarshal(s.body, &po); err != nil {
		return err
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
	pairs := []struct {
		name    string
		po      string
		invoice *string
	}{
		{"dpp", po.PoSubtotal, inv.Dpp},
		{"dppNilaiLain", po.PoDppNilaiLain, inv.DppNilaiLain},
		{"ppnAmount", po.PoPpnAmount, inv.PpnAmount},
		{"total", po.PoGrandTotal, inv.Total},
		{"totalDiscount", po.PoTotalDiscount, inv.TotalDiscount},
	}
	for _, p := range pairs {
		if p.invoice == nil {
			return fmt.Errorf("invoice %s is null", p.name)
		}
		if !numericEquals(p.po, *p.invoice) {
			return fmt.Errorf("%s: PO %s invoice %s", p.name, p.po, *p.invoice)
		}
	}
	return nil
}

func (s *scenarioState) poFileNameEquals(want string) error {
	var po purchaseorders.PurchaseOrder
	if err := json.Unmarshal(s.body, &po); err != nil {
		return err
	}
	if po.FileName == nil || *po.FileName != want {
		got := ""
		if po.FileName != nil {
			got = *po.FileName
		}
		return fmt.Errorf("want %s got %s", want, got)
	}
	return nil
}

func (s *scenarioState) poItemsAtLeastProducts(min int) error {
	var rows []purchaseorders.PurchaseOrderItem
	if err := json.Unmarshal(s.body, &rows); err != nil {
		return err
	}
	count := 0
	for _, it := range rows {
		if it.ItemType == "product" {
			count++
		}
	}
	if count < min {
		return fmt.Errorf("want >=%d products got %d", min, count)
	}
	return nil
}

func (s *scenarioState) poListAtLeast(min int) error {
	var rows []purchaseorders.PurchaseOrder
	if err := json.Unmarshal(s.body, &rows); err != nil {
		return err
	}
	if len(rows) < min {
		return fmt.Errorf("want >=%d rows got %d", min, len(rows))
	}
	return nil
}

func (s *scenarioState) walkPOPath(path string) error {
	if strings.TrimSpace(path) == "" {
		s.last = &http.Response{StatusCode: http.StatusNoContent}
		s.body = nil
		return nil
	}
	for _, step := range strings.Split(path, ",") {
		if err := s.transitionPOTo(strings.TrimSpace(step)); err != nil {
			return err
		}
		if s.last.StatusCode != http.StatusNoContent {
			return fmt.Errorf("step %s wanted 204 got %d body=%s", step, s.last.StatusCode, s.body)
		}
	}
	return nil
}

func (s *scenarioState) transitionPOTo(target string) error {
	body := purchaseorders.ChangeStatusRequest{Status: purchaseorders.Status(target)}
	return s.sendRequest(http.MethodPatch, "/purchase-orders/"+strconv.FormatInt(s.poID, 10)+"/status", body)
}

func (s *scenarioState) tryPOTransition(target string) error {
	return s.transitionPOTo(target)
}

func (s *scenarioState) lastTransitionSucceeds() error {
	if s.last.StatusCode != http.StatusNoContent {
		return fmt.Errorf("last not 204: %d body=%s", s.last.StatusCode, s.body)
	}
	return nil
}

// Key shaped like storage.BuildObjectKey output.
func (s *scenarioState) uploadPOFile(name string) error {
	return s.attachFile("po.pdf", 1024, fmt.Sprintf("po/%d/1-%s", s.poID, name))
}

func (s *scenarioState) attachFile(fileName string, size int64, key string) error {
	body := purchaseorders.UpdateFileRequest{FileName: fileName, FileSize: size, ObjectKey: key}
	return s.sendRequest(http.MethodPatch, "/purchase-orders/"+strconv.FormatInt(s.poID, 10)+"/file", body)
}

// {po} is this PO, {other} a second one.
func (s *scenarioState) attachFileUnderKey(fileName string, size int64, key string) error {
	key = strings.ReplaceAll(key, "{po}", strconv.FormatInt(s.poID, 10))
	if strings.Contains(key, "{other}") {
		otherID, err := s.otherPOID()
		if err != nil {
			return err
		}
		key = strings.ReplaceAll(key, "{other}", strconv.FormatInt(otherID, 10))
	}
	return s.attachFile(fileName, size, key)
}

// otherPOID accepts a second quotation.
// acceptedQuotationWith registers it with the cleaner, like the first.
func (s *scenarioState) otherPOID() (int64, error) {
	poID, quotationID := s.poID, s.quotationID
	defer func() { s.poID, s.quotationID = poID, quotationID }()
	if err := s.acceptedQuotation(); err != nil {
		return 0, err
	}
	if s.poID == poID {
		return 0, fmt.Errorf("second quotation reused PO %d", poID)
	}
	return s.poID, nil
}

func (s *scenarioState) fieldSays(field, want string) error {
	var problem struct {
		Detail string            `json:"detail"`
		Fields map[string]string `json:"fields"`
	}
	if err := json.Unmarshal(s.body, &problem); err != nil {
		return fmt.Errorf("decode problem: %w body=%s", err, s.body)
	}
	if got := problem.Fields[field]; !strings.Contains(got, want) {
		return fmt.Errorf("want %s to mention %q got %q body=%s", field, want, got, s.body)
	}
	if !strings.Contains(problem.Detail, want) {
		return fmt.Errorf("detail %q does not carry the field message", problem.Detail)
	}
	return nil
}

// Every PO lock refusal shares one shape.
func (s *scenarioState) poRefusedAsLocked(detail string) error {
	if s.last.StatusCode != http.StatusConflict {
		return fmt.Errorf("want 409 got %d body=%s", s.last.StatusCode, s.body)
	}
	if ct := s.last.Header.Get("Content-Type"); ct != "application/problem+json" {
		return fmt.Errorf("want problem+json got %q", ct)
	}
	var problem struct {
		Status int    `json:"status"`
		Detail string `json:"detail"`
		Code   string `json:"code"`
	}
	if err := json.Unmarshal(s.body, &problem); err != nil {
		return fmt.Errorf("decode problem: %w body=%s", err, s.body)
	}
	if problem.Code != purchaseorders.LockedCode || problem.Status != http.StatusConflict {
		return fmt.Errorf("want code %q status 409, body=%s", purchaseorders.LockedCode, s.body)
	}
	if !strings.Contains(problem.Detail, detail) {
		return fmt.Errorf("detail %q does not mention %q", problem.Detail, detail)
	}
	return nil
}

func (s *scenarioState) poHasNoFile() error {
	var po purchaseorders.PurchaseOrder
	if err := json.Unmarshal(s.body, &po); err != nil {
		return err
	}
	if po.FileURL != nil || po.FileName != nil {
		return fmt.Errorf("want no file got %s", s.body)
	}
	return nil
}

func (s *scenarioState) editPOItems(discountPct, sellingPrice string) error {
	if err := s.sendRequest(http.MethodGet, "/purchase-orders/"+strconv.FormatInt(s.poID, 10), nil); err != nil {
		return err
	}
	var po purchaseorders.PurchaseOrder
	if err := json.Unmarshal(s.body, &po); err != nil {
		return err
	}
	body := purchaseorders.UpdateItemsRequest{
		DiscountPct: discountPct,
		Items: []purchaseorders.UpdateItemsLine{{
			ItemName:     "Edited Product",
			Qty:          "1",
			UnitID:       int16PtrAcc(defaultUnit),
			SellingPrice: sellingPrice,
		}},
	}
	return s.sendRequestWithHeaders(
		http.MethodPut,
		"/purchase-orders/"+strconv.FormatInt(s.poID, 10)+"/items",
		body,
		map[string]string{"If-Match": strconv.FormatInt(int64(po.RowVersion), 10)},
	)
}

func int16PtrAcc(v int16) *int16 { return &v }

// The 422 must say which record blocks the promotion.
func (s *scenarioState) errorNamesIncompleteClient() error {
	var problem struct {
		Detail string            `json:"detail"`
		Fields map[string]string `json:"fields"`
	}
	if err := json.Unmarshal(s.body, &problem); err != nil {
		return err
	}
	key := "klien:" + strconv.FormatInt(incompleteCompany, 10)
	if _, ok := problem.Fields[key]; !ok {
		return fmt.Errorf("want field %s, got %+v", key, problem.Fields)
	}
	if !strings.Contains(problem.Detail, "belum lengkap") {
		return fmt.Errorf("detail does not explain the gap: %s", problem.Detail)
	}
	return nil
}

func (s *scenarioState) editPODetails(poNumber string) error {
	body := purchaseorders.UpdateDetailsRequest{PoNumber: poNumber, PoDate: "2026-01-15"}
	return s.sendRequest(
		http.MethodPatch,
		"/purchase-orders/"+strconv.FormatInt(s.poID, 10)+"/details",
		body,
	)
}

// Stale If-Match must lose the race, not overwrite silently.
func (s *scenarioState) editPODetailsStaleVersion() error {
	body := purchaseorders.UpdateDetailsRequest{PoNumber: "PO/STALE", PoDate: "2026-01-15"}
	return s.sendRequestWithHeaders(
		http.MethodPatch,
		"/purchase-orders/"+strconv.FormatInt(s.poID, 10)+"/details",
		body,
		map[string]string{"If-Match": "999"},
	)
}

func (s *scenarioState) editPONotesStaleVersion() error {
	body := purchaseorders.UpdateNotesRequest{Notes: "stale"}
	return s.sendRequestWithHeaders(
		http.MethodPatch,
		"/purchase-orders/"+strconv.FormatInt(s.poID, 10)+"/notes",
		body,
		map[string]string{"If-Match": "999"},
	)
}

// Move the PO's invoice to sent, which files it with the client.
func (s *scenarioState) sendInvoice() error {
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
	return s.sendRequest(
		http.MethodPatch,
		"/invoices/"+strconv.FormatInt(inv.ID, 10)+"/status",
		invoices.ChangeStatusRequest{Status: invoices.StatusSent},
	)
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

// Fetch invoice items via invoice id.
func (s *scenarioState) listInvoiceItems() error {
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
	return s.sendRequest(http.MethodGet, "/invoices/"+strconv.FormatInt(inv.ID, 10)+"/items", nil)
}

// Assert any product line has price.
func (s *scenarioState) invoiceProductLineUnitPriceEquals(want string) error {
	var rows []invoices.InvoiceItem
	if err := json.Unmarshal(s.body, &rows); err != nil {
		return err
	}
	for _, it := range rows {
		if it.LineType == "product" && numericEquals(it.UnitPrice, want) {
			return nil
		}
	}
	return fmt.Errorf("no product line with unitPrice=%s, got %+v", want, rows)
}

// Compare numeric strings ignoring scale.
func numericEquals(a, b string) bool {
	return trimNumeric(a) == trimNumeric(b)
}

func trimNumeric(v string) string {
	if !strings.Contains(v, ".") {
		return v
	}
	v = strings.TrimRight(v, "0")
	return strings.TrimRight(v, ".")
}

func initScenario(t *testing.T, cleaner *testutil.Cleaner) func(*godog.ScenarioContext) {
	return func(sc *godog.ScenarioContext) {
		state := &scenarioState{t: t, userID: defaultUserID, cleaner: cleaner}
		sc.Before(func(ctx context.Context, _ *godog.Scenario) (context.Context, error) {
			state.last = nil
			state.body = nil
			state.quotationID = 0
			state.poID = 0
			state.dnNumber = ""
			return ctx, nil
		})
		sc.After(func(ctx context.Context, _ *godog.Scenario, err error) (context.Context, error) {
			return ctx, state.releaseRoleUsers()
		})
		registerStatusSteps(sc, state)

		sc.Step(`^an authenticated user with id (\d+)$`, func(id int64) error { return state.authenticatedUser(id) })
		sc.Step(`^the commercial domain is empty$`, state.emptyDomain)
		sc.Step(`^an accepted quotation$`, state.acceptedQuotation)
		sc.Step(`^an accepted quotation for a client with missing data$`, state.acceptedQuotationIncompleteClient)
		sc.Step(`^the error names the incomplete client$`, state.errorNamesIncompleteClient)
		sc.Step(`^the user reads the PO by quotation$`, state.readPOByQuotation)
		sc.Step(`^the user reads the invoice by quotation$`, state.readInvoiceByQuotation)
		sc.Step(`^the user lists PO items$`, state.listPOItems)
		sc.Step(`^the user lists POs filtered by status "([^"]+)"$`, state.listPOsByStatus)
		sc.Step(`^the response status is (\d+)$`, state.statusEquals)
		sc.Step(`^the PO status is "([^"]+)"$`, state.poDetailStatusEquals)
		sc.Step(`^the PO number is set$`, state.poNumberSet)
		sc.Step(`^the PO file name is "([^"]+)"$`, state.poFileNameEquals)
		sc.Step(`^the PO discount is "([^"]+)"$`, state.poDiscountEquals)
		sc.Step(`^the PO totals equal the invoice totals$`, state.poTotalsEqualInvoice)
		sc.Step(`^the items contain at least (\d+) product line(?:s)?$`, state.poItemsAtLeastProducts)
		sc.Step(`^the PO list contains at least (\d+) row(?:s)?$`, state.poListAtLeast)
		sc.Step(`^the user transitions the PO through "([^"]*)"$`, state.walkPOPath)
		sc.Step(`^every PO transition succeeds$`, state.lastTransitionSucceeds)
		sc.Step(`^the user tries to transition the PO to "([^"]+)"$`, state.tryPOTransition)
		sc.Step(`^the user uploads a PO file named "([^"]+)"$`, state.uploadPOFile)
		sc.Step(`^the user attaches "([^"]*)" of (-?\d+) bytes under the key "([^"]*)"$`, state.attachFileUnderKey)
		sc.Step(`^the field "([^"]+)" says "([^"]+)"$`, state.fieldSays)
		sc.Step(`^the PO is refused as locked with "([^"]+)"$`, state.poRefusedAsLocked)
		sc.Step(`^the PO has no attached file$`, state.poHasNoFile)
		sc.Step(`^the invoice status is "([^"]+)"$`, state.invoiceStatusEquals)
		sc.Step(`^the user edits PO items with discount "([^"]*)" and selling price "([^"]*)"$`, state.editPOItems)
		sc.Step(`^the user lists invoice items by quotation$`, state.listInvoiceItems)
		sc.Step(`^the user edits PO details with number "([^"]+)"$`, state.editPODetails)
		sc.Step(`^the user edits PO details with a stale If-Match$`, state.editPODetailsStaleVersion)
		sc.Step(`^the user edits PO notes with a stale If-Match$`, state.editPONotesStaleVersion)
		sc.Step(`^the user sends the invoice$`, state.sendInvoice)
		sc.Step(`^an invoice product line has unit price "([^"]+)"$`, state.invoiceProductLineUnitPriceEquals)
		sc.Step(`^the user downloads the delivery note$`, state.downloadDeliveryNote)
		sc.Step(`^the PO has a delivery note number$`, state.poHasDeliveryNoteNumber)
		sc.Step(`^the delivery note number is unchanged$`, state.deliveryNoteNumberUnchanged)
		sc.Step(`^the user exports the PO list$`, state.exportPOList)
		sc.Step(`^the export lists the stored delivery note number$`, state.exportListsDeliveryNoteNumber)
		sc.Step(`^the export shows the status "([^"]+)"$`, state.exportShowsStatusLabel)
		sc.Step(`^an accepted quotation offering catalog item (\d+) for "([^"]+)"$`, state.acceptedQuotationOffering)
		sc.Step(`^the first PO line is named after catalog item (\d+)$`, state.firstLineNamedAfterItem)
		sc.Step(`^catalog item (\d+) has no IMPA code$`, state.catalogItemHasNoCode)
		sc.Step(`^the first PO line has no item code$`, state.firstLineHasNoCode)
	}
}

func TestPurchaseOrderFeatures(t *testing.T) {
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
