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
	"testing"

	"github.com/cucumber/godog"
	"github.com/shopspring/decimal"

	"github.com/nathangalung/internalgns/apps/api/internal/dashboard"
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
	t         *testing.T
	commerce  *httptest.Server
	last      *http.Response
	body      []byte
	invoiceID int64
	summary   dashboard.Summary
}

// send issues a request and keeps the response.
func (s *scenarioState) send(srv *httptest.Server, method, path string, body any) error {
	var rdr io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			return err
		}
		rdr = bytes.NewReader(raw)
	}
	req, err := http.NewRequest(method, srv.URL+path, rdr)
	if err != nil {
		return err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	res, err := srv.Client().Do(req)
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

// expect sends and fails on any other status.
func (s *scenarioState) expect(want int, method, path string, body any) error {
	if err := s.send(s.commerce, method, path, body); err != nil {
		return err
	}
	if s.last.StatusCode != want {
		return fmt.Errorf("%s %s want %d got %d body=%s", method, path, want, s.last.StatusCode, s.body)
	}
	return nil
}

func (s *scenarioState) emptyDomain() error {
	return testutil.ResetCommercialDomain(context.Background(), testutil.Pool(s.t))
}

// Walk quotation to a delivered PO and its invoice.
func (s *scenarioState) invoiceFor(qty, price, cost string) error {
	create := quotations.CreateRequest{
		CompanyClientID: defaultCompany,
		DiscountPct:     "0",
		Items: []quotations.CreateItem{{
			RequestedName: "Dashboard Product",
			Qty:           qty,
			UnitID:        defaultUnit,
			SellingPrice:  price,
			CostPrice:     &cost,
		}},
	}
	if err := s.expect(http.StatusCreated, http.MethodPost, "/quotations/", create); err != nil {
		return err
	}
	var created map[string]int64
	if err := json.Unmarshal(s.body, &created); err != nil {
		return err
	}
	qid := strconv.FormatInt(created["id"], 10)
	if err := s.expect(http.StatusNoContent, http.MethodPost, "/quotations/"+qid+"/send", nil); err != nil {
		return err
	}
	if err := s.expect(http.StatusNoContent, http.MethodPatch, "/quotations/"+qid+"/status",
		quotations.ChangeStatusRequest{Status: "accepted"}); err != nil {
		return err
	}
	if err := s.expect(http.StatusOK, http.MethodGet, "/purchase-orders/by-quotation/"+qid, nil); err != nil {
		return err
	}
	var po purchaseorders.PurchaseOrder
	if err := json.Unmarshal(s.body, &po); err != nil {
		return err
	}
	for _, target := range []purchaseorders.Status{purchaseorders.StatusUploaded, purchaseorders.StatusOnProgress, purchaseorders.StatusDelivered} {
		if err := s.expect(http.StatusNoContent, http.MethodPatch, "/purchase-orders/"+strconv.FormatInt(po.ID, 10)+"/status",
			purchaseorders.ChangeStatusRequest{Status: target}); err != nil {
			return err
		}
	}
	if err := s.expect(http.StatusOK, http.MethodGet, "/invoices/by-quotation/"+qid, nil); err != nil {
		return err
	}
	var inv invoices.Invoice
	if err := json.Unmarshal(s.body, &inv); err != nil {
		return err
	}
	s.invoiceID = inv.ID
	return nil
}

// invoiceTo supplies cancel reasons.
func (s *scenarioState) invoiceTo(path ...invoices.Status) error {
	for _, target := range path {
		req := invoices.ChangeStatusRequest{Status: target}
		if target == invoices.StatusCancelled {
			reason := "Salah alamat penagihan"
			req.Note = &reason
		}
		if err := s.expect(http.StatusNoContent, http.MethodPatch, "/invoices/"+strconv.FormatInt(s.invoiceID, 10)+"/status",
			req); err != nil {
			return err
		}
	}
	return nil
}

// cancelAndReplace voids the invoice and issues its Pengganti.
func (s *scenarioState) cancelAndReplace() error {
	if err := s.invoiceTo(invoices.StatusCancelled); err != nil {
		return err
	}
	return s.expect(http.StatusCreated, http.MethodPost, "/invoices/"+strconv.FormatInt(s.invoiceID, 10)+"/replacement", nil)
}

func (s *scenarioState) invoiceCountIs(want int64) error {
	if s.summary.TotalInvoices != want {
		return fmt.Errorf("total invoices want %d got %d", want, s.summary.TotalInvoices)
	}
	return nil
}

func (s *scenarioState) readSummaryAs(role string) error {
	if err := s.send(testutil.DashboardServerAs(s.t, role), http.MethodGet, "/dashboard/summary", nil); err != nil {
		return err
	}
	if s.last.StatusCode != http.StatusOK {
		return nil
	}
	return json.Unmarshal(s.body, &s.summary)
}

func (s *scenarioState) statusEquals(want int) error {
	if s.last.StatusCode != want {
		return fmt.Errorf("want %d got %d body=%s", want, s.last.StatusCode, s.body)
	}
	return nil
}

// rawSum reads one aggregate straight from the tables.
func (s *scenarioState) rawSum(sql string) (decimal.Decimal, error) {
	var raw string
	if err := testutil.Pool(s.t).QueryRow(context.Background(), sql).Scan(&raw); err != nil {
		return decimal.Zero, err
	}
	return decimal.NewFromString(raw)
}

// figureMatches compares a summary figure with a literal and a raw sum.
func figureMatches(name, got, want string, raw decimal.Decimal) error {
	g, err := decimal.NewFromString(got)
	if err != nil {
		return err
	}
	w, err := decimal.NewFromString(want)
	if err != nil {
		return err
	}
	if !g.Equal(w) {
		return fmt.Errorf("%s want %s got %s", name, w, g)
	}
	if !g.Equal(raw) {
		return fmt.Errorf("%s %s does not match the raw sum %s", name, g, raw)
	}
	return nil
}

func (s *scenarioState) revenueIs(want string) error {
	raw, err := s.rawSum(`SELECT COALESCE(SUM(dpp), 0)::text FROM invoices WHERE status = 'paid'`)
	if err != nil {
		return err
	}
	return figureMatches("revenue", s.summary.TotalRevenue, want, raw)
}

func (s *scenarioState) expensesAre(want string) error {
	raw, err := s.rawSum(`
		SELECT COALESCE(SUM(poi.qty * poi.cost_price), 0)::text
		  FROM purchase_order_items poi
		  JOIN invoices i ON i.po_id = poi.po_id AND i.status = 'paid'
		 WHERE poi.item_type = 'product' AND poi.cost_price IS NOT NULL`)
	if err != nil {
		return err
	}
	return figureMatches("expenses", s.summary.TotalExpenses, want, raw)
}

func (s *scenarioState) profitIs(want string) error {
	got, err := decimal.NewFromString(s.summary.TotalProfit)
	if err != nil {
		return err
	}
	w, err := decimal.NewFromString(want)
	if err != nil {
		return err
	}
	if !got.Equal(w) {
		return fmt.Errorf("net profit want %s got %s", w, got)
	}
	return nil
}

func (s *scenarioState) ppnIs(want string) error {
	raw, err := s.rawSum(`SELECT COALESCE(SUM(ppn_amount), 0)::text FROM invoices WHERE status = 'paid'`)
	if err != nil {
		return err
	}
	return figureMatches("PPN", s.summary.TotalPpn, want, raw)
}

func initScenario(t *testing.T) func(*godog.ScenarioContext) {
	return func(sc *godog.ScenarioContext) {
		state := &scenarioState{t: t}
		sc.Before(func(ctx context.Context, _ *godog.Scenario) (context.Context, error) {
			state.commerce = testutil.FullServer(t, defaultUserID)
			state.last = nil
			state.body = nil
			state.invoiceID = 0
			state.summary = dashboard.Summary{}
			return ctx, nil
		})

		sc.Step(`^the commercial domain is empty$`, state.emptyDomain)
		sc.Step(`^an invoice for (\d+) units at (\d+) costing (\d+) each$`, state.invoiceFor)
		sc.Step(`^the invoice is paid$`, func() error { return state.invoiceTo(invoices.StatusSent, invoices.StatusPaid) })
		sc.Step(`^the invoice is sent$`, func() error { return state.invoiceTo(invoices.StatusSent) })
		sc.Step(`^the invoice is cancelled and replaced$`, state.cancelAndReplace)
		sc.Step(`^the dashboard counts (\d+) invoices?$`, state.invoiceCountIs)
		sc.Step(`^finance reads the dashboard summary$`, func() error { return state.readSummaryAs("finance") })
		sc.Step(`^the response status is (\d+)$`, state.statusEquals)
		sc.Step(`^revenue is ([\d.]+) and equals the paid DPP sum$`, state.revenueIs)
		sc.Step(`^expenses are ([\d.]+) and equal the paid cost sum$`, state.expensesAre)
		sc.Step(`^net profit is ([\d.]+)$`, state.profitIs)
		sc.Step(`^PPN is ([\d.]+) and equals the paid PPN sum$`, state.ppnIs)
	}
}

func TestDashboardFeatures(t *testing.T) {
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
