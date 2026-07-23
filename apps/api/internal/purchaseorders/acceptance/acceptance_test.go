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
	defaultUserID  int64 = 1
	defaultCompany int64 = 1
	defaultUnit    int16 = 19
)

type scenarioState struct {
	t           *testing.T
	srv         *httptest.Server
	last        *http.Response
	body        []byte
	userID      int64
	quotationID int64
	poID        int64
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
	create := quotations.CreateRequest{
		CompanyClientID: defaultCompany,
		DiscountPct:     "0",
		Items: []quotations.CreateItem{{
			RequestedName: "Test Product",
			Qty:           "2",
			UnitID:        defaultUnit,
			SellingPrice:  "100000",
		}},
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

func (s *scenarioState) uploadPOFile(name string) error {
	body := purchaseorders.UpdateFileRequest{FileName: name, FileSize: 1024, ObjectKey: "data:application/pdf;base64,"}
	return s.sendRequest(http.MethodPatch, "/purchase-orders/"+strconv.FormatInt(s.poID, 10)+"/file", body)
}

func (s *scenarioState) uploadPOFileEmptyName() error {
	body := purchaseorders.UpdateFileRequest{FileName: "", FileSize: 1, ObjectKey: "x"}
	return s.sendRequest(http.MethodPatch, "/purchase-orders/"+strconv.FormatInt(s.poID, 10)+"/file", body)
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

func initScenario(t *testing.T) func(*godog.ScenarioContext) {
	return func(sc *godog.ScenarioContext) {
		state := &scenarioState{t: t, userID: defaultUserID}
		sc.Before(func(ctx context.Context, _ *godog.Scenario) (context.Context, error) {
			state.last = nil
			state.body = nil
			state.quotationID = 0
			state.poID = 0
			return ctx, nil
		})

		sc.Step(`^an authenticated user with id (\d+)$`, func(id int64) error { return state.authenticatedUser(id) })
		sc.Step(`^the commercial domain is empty$`, state.emptyDomain)
		sc.Step(`^an accepted quotation$`, state.acceptedQuotation)
		sc.Step(`^the user reads the PO by quotation$`, state.readPOByQuotation)
		sc.Step(`^the user reads the invoice by quotation$`, state.readInvoiceByQuotation)
		sc.Step(`^the user lists PO items$`, state.listPOItems)
		sc.Step(`^the user lists POs filtered by status "([^"]+)"$`, state.listPOsByStatus)
		sc.Step(`^the response status is (\d+)$`, state.statusEquals)
		sc.Step(`^the PO status is "([^"]+)"$`, state.poDetailStatusEquals)
		sc.Step(`^the PO number is set$`, state.poNumberSet)
		sc.Step(`^the PO file name is "([^"]+)"$`, state.poFileNameEquals)
		sc.Step(`^the items contain at least (\d+) product line(?:s)?$`, state.poItemsAtLeastProducts)
		sc.Step(`^the PO list contains at least (\d+) row(?:s)?$`, state.poListAtLeast)
		sc.Step(`^the user transitions the PO through "([^"]*)"$`, state.walkPOPath)
		sc.Step(`^every PO transition succeeds$`, state.lastTransitionSucceeds)
		sc.Step(`^the user tries to transition the PO to "([^"]+)"$`, state.tryPOTransition)
		sc.Step(`^the user uploads a PO file named "([^"]+)"$`, state.uploadPOFile)
		sc.Step(`^the user uploads a PO file with empty filename$`, state.uploadPOFileEmptyName)
		sc.Step(`^the invoice status is "([^"]+)"$`, state.invoiceStatusEquals)
		sc.Step(`^the user edits PO items with discount "([^"]*)" and selling price "([^"]*)"$`, state.editPOItems)
		sc.Step(`^the user lists invoice items by quotation$`, state.listInvoiceItems)
		sc.Step(`^an invoice product line has unit price "([^"]+)"$`, state.invoiceProductLineUnitPriceEquals)
	}
}

func TestPurchaseOrderFeatures(t *testing.T) {
	testutil.RequireDB(t)
	suite := godog.TestSuite{
		ScenarioInitializer: initScenario(t),
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
