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
	"time"

	"github.com/cucumber/godog"
	"github.com/shopspring/decimal"
	"github.com/xuri/excelize/v2"

	"github.com/nathangalung/internalgns/apps/api/internal/dashboard"
	"github.com/nathangalung/internalgns/apps/api/internal/invoices"
	"github.com/nathangalung/internalgns/apps/api/internal/purchaseorders"
	"github.com/nathangalung/internalgns/apps/api/internal/quotations"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/tz"
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
	book      workbook
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
	// UPLOADED follows the PO file.
	poPath := "/purchase-orders/" + strconv.FormatInt(po.ID, 10)
	if err := s.expect(http.StatusNoContent, http.MethodPatch, poPath+"/file", purchaseorders.UpdateFileRequest{
		FileName: "po.pdf", FileSize: 1024, ObjectKey: "po/" + strconv.FormatInt(po.ID, 10) + "/1-po.pdf",
	}); err != nil {
		return err
	}
	for _, target := range []purchaseorders.Status{purchaseorders.StatusOnProgress, purchaseorders.StatusDelivered} {
		if err := s.expect(http.StatusNoContent, http.MethodPatch, poPath+"/status",
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

// quotationIn inserts a quotation.
// Kedaluwarsa has no API path, so the row is written directly.
func (s *scenarioState) quotationIn(status string) error {
	_, err := testutil.Pool(s.t).Exec(context.Background(), `
		INSERT INTO quotations (quotation_no, company_client_id, company_client_name,
		                        discount_pct, total_produk, total, total_discount,
		                        status, created_by, updated_by)
		VALUES ('SQ-DASH-' || upper($1), $2, 'PT. IMC Ship Management', 0, 10000, 10000, 0, $1, $3, $3)`,
		status, defaultCompany, defaultUserID)
	if err != nil {
		return fmt.Errorf("insert %s quotation: %w", status, err)
	}
	return nil
}

func (s *scenarioState) invoicePastDue() error {
	_, err := testutil.Pool(s.t).Exec(context.Background(),
		`UPDATE invoices SET due_date = CURRENT_DATE - 1 WHERE id = $1`, s.invoiceID)
	if err != nil {
		return fmt.Errorf("move due date: %w", err)
	}
	return nil
}

// tilesRead compares tiles in order.
// Each reads status:count.
func (s *scenarioState) tilesRead(entity, want string) error {
	tiles := map[string][]dashboard.StatusCount{
		"quotation":      s.summary.QuotationStatuses,
		"purchase order": s.summary.PoStatuses,
		"invoice":        s.summary.InvoiceStatuses,
	}[entity]
	got := make([]string, 0, len(tiles))
	for _, c := range tiles {
		got = append(got, c.Status+":"+strconv.FormatInt(c.Count, 10))
	}
	if strings.Join(got, ",") != want {
		return fmt.Errorf("%s tiles want %q got %q", entity, want, strings.Join(got, ","))
	}
	return nil
}

func (s *scenarioState) rejectedCountIs(want int64) error {
	if s.summary.TotalQuotationsRejected != want {
		return fmt.Errorf("rejected quotations want %d got %d", want, s.summary.TotalQuotationsRejected)
	}
	return nil
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

// invoiceDue moves the invoice due date, optionally storing a status.
// A stored overdue is legacy data no API move writes any more.
func (s *scenarioState) invoiceDue(status string, days int) error {
	_, err := testutil.Pool(s.t).Exec(context.Background(),
		`UPDATE invoices SET status = COALESCE(NULLIF($2, ''), status), due_date = CURRENT_DATE + $3::int WHERE id = $1`,
		s.invoiceID, status, days)
	if err != nil {
		return fmt.Errorf("move due date: %w", err)
	}
	return nil
}

func (s *scenarioState) financialFigures(want string) error {
	stripped := s.summary.TotalRevenue == "0" && s.summary.TotalExpenses == "0" &&
		s.summary.TotalProfit == "0" && s.summary.TotalPpn == "0" &&
		s.summary.TotalInvoices == 0 && s.summary.TotalInvoicesPaid == 0 &&
		s.summary.InvoicesDueSoon == 0 && s.summary.InvoicesOverdue == 0 &&
		len(s.summary.InvoiceStatuses) == 0
	shown := s.summary.TotalRevenue != "0" && s.summary.TotalInvoices == 1 &&
		s.summary.TotalInvoicesPaid == 1 && len(s.summary.InvoiceStatuses) > 0
	if (want == "stripped" && !stripped) || (want == "shown" && !shown) {
		return fmt.Errorf("financial figures want %s got %+v", want, s.summary)
	}
	// Operational figures survive the strip.
	if s.summary.TotalQuotations != 1 || s.summary.TotalPo != 1 {
		return fmt.Errorf("operational figures want 1 quotation and 1 PO got %d and %d",
			s.summary.TotalQuotations, s.summary.TotalPo)
	}
	return nil
}

func (s *scenarioState) readSeriesAs(role, metric string) error {
	return s.send(testutil.DashboardServerAs(s.t, role), http.MethodGet, "/dashboard/timeseries?metric="+metric, nil)
}

func (s *scenarioState) readSeriesRange(role, metric, interval, from, to string) error {
	path := "/dashboard/timeseries?metric=" + metric + "&interval=" + interval + "&from=" + from + "&to=" + to
	return s.send(testutil.DashboardServerAs(s.t, role), http.MethodGet, path, nil)
}

// seriesReads compares month:value pairs in order.
func (s *scenarioState) seriesReads(want string) error {
	var points []dashboard.TimeseriesPoint
	if err := json.Unmarshal(s.body, &points); err != nil {
		return err
	}
	got := make([]string, 0, len(points))
	for _, p := range points {
		got = append(got, p.Month+":"+p.Value)
	}
	if strings.Join(got, ",") != want {
		return fmt.Errorf("series want %q got %q", want, strings.Join(got, ","))
	}
	return nil
}

// quotationCreatedAt inserts a quotation at an instant.
func (s *scenarioState) quotationCreatedAt(instant string) error {
	at, err := time.Parse(time.RFC3339, instant)
	if err != nil {
		return err
	}
	_, err = testutil.Pool(s.t).Exec(context.Background(), `
		INSERT INTO quotations (quotation_no, company_client_id, company_client_name,
		                        discount_pct, total_produk, total, total_discount,
		                        created_at, created_by, updated_by)
		VALUES ('SQ-DASH-WIB', $1, 'PT. IMC Ship Management', 0, 10000, 10000, 0, $2, $3, $3)`,
		defaultCompany, at, defaultUserID)
	if err != nil {
		return fmt.Errorf("insert quotation at %s: %w", instant, err)
	}
	return nil
}

// yearOf resolves "the current year" in WIB.
func yearOf(spec string) (int, error) {
	if spec == "the current year" {
		return tz.Now().Year(), nil
	}
	return strconv.Atoi(strings.TrimPrefix(spec, "year "))
}

func (s *scenarioState) exportAs(role, spec string) error {
	y, err := yearOf(spec)
	if err != nil {
		return err
	}
	if err := s.send(testutil.DashboardServerAs(s.t, role), http.MethodGet,
		"/dashboard/export.xlsx?year="+strconv.Itoa(y), nil); err != nil {
		return err
	}
	if s.last.StatusCode != http.StatusOK {
		return nil
	}
	s.book, err = readBook(s.body)
	return err
}

func (s *scenarioState) fileNamedForCurrentYear() error {
	want := fmt.Sprintf(`filename="dashboard-export-%d.xlsx"`, tz.Now().Year())
	if got := s.last.Header.Get("Content-Disposition"); !strings.Contains(got, want) {
		return fmt.Errorf("Content-Disposition want %s got %q", want, got)
	}
	return nil
}

func (s *scenarioState) monthsListed(spec string) error {
	y, err := yearOf(spec)
	if err != nil {
		return err
	}
	if len(s.book.months) != 12 {
		return fmt.Errorf("want 12 monthly rows got %d", len(s.book.months))
	}
	for i, row := range s.book.months {
		if want := fmt.Sprintf("%d-%02d", y, i+1); row[0] != want {
			return fmt.Errorf("row %d want month %s got %s", i+1, want, row[0])
		}
	}
	return nil
}

// Ringkasan rows and their Bulanan columns.
var reconciled = []struct{ total, column string }{
	{"Total Quotation", "Quotation"},
	{"Total Invoice", "Invoice"},
	{"Total Pendapatan", "Pendapatan"},
	{"Total Laba Bersih", "Laba Bersih"},
	{"Total PPN", "PPN"},
}

func (s *scenarioState) totalsEqualMonthlySums() error {
	for _, r := range reconciled {
		total, err := s.book.total(r.total)
		if err != nil {
			return err
		}
		sum, err := s.book.columnSum(r.column)
		if err != nil {
			return err
		}
		if !total.Equal(sum) {
			return fmt.Errorf("%s is %s but the %s column sums to %s", r.total, total, r.column, sum)
		}
	}
	return nil
}

func (s *scenarioState) exportRevenueMatchesTables() error {
	y := tz.Now().Year()
	var raw string
	if err := testutil.Pool(s.t).QueryRow(context.Background(), `
		SELECT COALESCE(SUM(dpp), 0)::text FROM invoices
		 WHERE status = 'paid' AND invoice_date >= make_date($1, 1, 1) AND invoice_date < make_date($1 + 1, 1, 1)`,
		y).Scan(&raw); err != nil {
		return err
	}
	want, err := decimal.NewFromString(raw)
	if err != nil {
		return err
	}
	got, err := s.book.total("Total Pendapatan")
	if err != nil {
		return err
	}
	if !got.Equal(want) || want.IsZero() {
		return fmt.Errorf("export revenue %s, paid DPP sum %s", got, want)
	}
	return nil
}

func (s *scenarioState) everyExportFigureZero() error {
	for label, v := range s.book.totals {
		if !v.IsZero() {
			return fmt.Errorf("%s want 0 got %s", label, v)
		}
	}
	for _, row := range s.book.months {
		for _, cell := range row[1:] {
			if cell != "0" {
				return fmt.Errorf("month %s carries %s", row[0], cell)
			}
		}
	}
	return nil
}

func (s *scenarioState) everySummaryFigureZero() error {
	money := []string{s.summary.TotalRevenue, s.summary.TotalExpenses, s.summary.TotalProfit, s.summary.TotalPpn}
	for _, m := range money {
		d, err := decimal.NewFromString(m)
		if err != nil {
			return err
		}
		if !d.IsZero() {
			return fmt.Errorf("money figure want 0 got %s in %+v", m, s.summary)
		}
	}
	counts := []int64{s.summary.TotalQuotations, s.summary.TotalQuotationsRejected, s.summary.TotalPo,
		s.summary.TotalInvoices, s.summary.TotalInvoicesPaid, s.summary.InvoicesDueSoon, s.summary.InvoicesOverdue}
	for _, c := range counts {
		if c != 0 {
			return fmt.Errorf("count want 0 got %d in %+v", c, s.summary)
		}
	}
	return nil
}

func (s *scenarioState) overdueAndDueSoon(overdue, soon int64) error {
	if s.summary.InvoicesOverdue != overdue || s.summary.InvoicesDueSoon != soon {
		return fmt.Errorf("want %d overdue and %d due soon got %d and %d",
			overdue, soon, s.summary.InvoicesOverdue, s.summary.InvoicesDueSoon)
	}
	return nil
}

// dueCountsMatchTables recounts from the rows.
// The predicate is spelled out here rather than calling the SQL helper, so
// the check does not grade the helper against itself.
func (s *scenarioState) dueCountsMatchTables() error {
	var overdue, soon int64
	if err := testutil.Pool(s.t).QueryRow(context.Background(), `
		SELECT COUNT(*) FILTER (WHERE status = 'overdue'
		                           OR (status IN ('draft', 'sent') AND due_date < CURRENT_DATE)),
		       COUNT(*) FILTER (WHERE status IN ('draft', 'sent')
		                          AND due_date >= CURRENT_DATE AND due_date <= CURRENT_DATE + 7)
		  FROM invoices
		 WHERE status <> 'cancelled'`).Scan(&overdue, &soon); err != nil {
		return err
	}
	return s.overdueAndDueSoon(overdue, soon)
}

// workbook is the parsed dashboard export.
type workbook struct {
	totals map[string]decimal.Decimal
	header []string
	months [][]string
}

func readBook(raw []byte) (workbook, error) {
	f, err := excelize.OpenReader(bytes.NewReader(raw))
	if err != nil {
		return workbook{}, err
	}
	defer func() { _ = f.Close() }()
	sum, err := f.GetRows("Ringkasan")
	if err != nil {
		return workbook{}, err
	}
	b := workbook{totals: map[string]decimal.Decimal{}}
	for _, row := range sum[1:] {
		v, err := decimal.NewFromString(row[1])
		if err != nil {
			return workbook{}, fmt.Errorf("Ringkasan %s: %w", row[0], err)
		}
		b.totals[row[0]] = v
	}
	rows, err := f.GetRows("Bulanan")
	if err != nil {
		return workbook{}, err
	}
	b.header, b.months = rows[0], rows[1:]
	return b, nil
}

func (b workbook) total(label string) (decimal.Decimal, error) {
	v, ok := b.totals[label]
	if !ok {
		return decimal.Zero, fmt.Errorf("Ringkasan has no %q row", label)
	}
	return v, nil
}

func (b workbook) columnSum(header string) (decimal.Decimal, error) {
	col := -1
	for i, h := range b.header {
		if h == header {
			col = i
		}
	}
	if col < 0 {
		return decimal.Zero, fmt.Errorf("Bulanan has no %q column", header)
	}
	sum := decimal.Zero
	for _, row := range b.months {
		v, err := decimal.NewFromString(row[col])
		if err != nil {
			return decimal.Zero, fmt.Errorf("Bulanan %s %s: %w", row[0], header, err)
		}
		sum = sum.Add(v)
	}
	return sum, nil
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
			state.book = workbook{}
			return ctx, nil
		})

		sc.Step(`^the commercial domain is empty$`, state.emptyDomain)
		sc.Step(`^an invoice for (\d+) units at (\d+) costing (\d+) each$`, state.invoiceFor)
		sc.Step(`^the invoice is paid$`, func() error { return state.invoiceTo(invoices.StatusSent, invoices.StatusPaid) })
		sc.Step(`^the invoice is sent$`, func() error { return state.invoiceTo(invoices.StatusSent) })
		sc.Step(`^the invoice is cancelled and replaced$`, state.cancelAndReplace)
		sc.Step(`^the dashboard counts (\d+) invoices?$`, state.invoiceCountIs)
		sc.Step(`^(superadmin|finance|operational) reads the dashboard summary$`, state.readSummaryAs)
		sc.Step(`^the invoice is due in (\d+) days$`, func(days int) error { return state.invoiceDue("", days) })
		sc.Step(`^the invoice is stored as overdue and due in (\d+) days$`, func(days int) error { return state.invoiceDue("overdue", days) })
		sc.Step(`^the financial figures are (shown|stripped)$`, state.financialFigures)
		sc.Step(`^(superadmin|finance|operational) reads the "([a-z]+)" series$`, state.readSeriesAs)
		sc.Step(`^(superadmin|finance|operational) reads the "([a-z]+)" series by (month|day) from "([0-9-]+)" to "([0-9-]+)"$`, state.readSeriesRange)
		sc.Step(`^the series reads "([^"]*)"$`, state.seriesReads)
		sc.Step(`^a quotation created at "([^"]+)"$`, state.quotationCreatedAt)
		sc.Step(`^(superadmin|finance|operational) exports the dashboard for (the current year|year \d{4})$`, state.exportAs)
		sc.Step(`^the file is named for the current year$`, state.fileNamedForCurrentYear)
		sc.Step(`^the monthly sheet lists the 12 months of (the current year|\d{4})$`, func(spec string) error {
			if spec != "the current year" {
				spec = "year " + spec
			}
			return state.monthsListed(spec)
		})
		sc.Step(`^each summary total equals the sum of its monthly column$`, state.totalsEqualMonthlySums)
		sc.Step(`^the summary revenue equals the paid DPP sum for the current year$`, state.exportRevenueMatchesTables)
		sc.Step(`^every summary and monthly figure is 0$`, state.everyExportFigureZero)
		sc.Step(`^every summary figure is 0$`, state.everySummaryFigureZero)
		sc.Step(`^the dashboard counts (\d+) overdue and (\d+) due soon invoices$`, state.overdueAndDueSoon)
		sc.Step(`^the overdue and due soon counts match the tables$`, state.dueCountsMatchTables)
		sc.Step(`^a quotation in status "([a-z]+)"$`, state.quotationIn)
		sc.Step(`^the invoice is past its due date$`, state.invoicePastDue)
		sc.Step(`^the (quotation|purchase order|invoice) tiles read "([^"]*)"$`, state.tilesRead)
		sc.Step(`^the dashboard counts (\d+) rejected quotations?$`, state.rejectedCountIs)
		sc.Step(`^the response status is (\d+)$`, state.statusEquals)
		sc.Step(`^revenue is ([\d.]+) and equals the paid DPP sum$`, state.revenueIs)
		sc.Step(`^expenses are ([\d.]+) and equal the paid cost sum$`, state.expensesAre)
		sc.Step(`^net profit is ([\d.]+)$`, state.profitIs)
		sc.Step(`^PPN is ([\d.]+) and equals the paid PPN sum$`, state.ppnIs)
	}
}

func TestDashboardFeatures(t *testing.T) {
	testutil.RequireDB(t)
	// Leave no scenario rows behind.
	t.Cleanup(func() {
		if err := testutil.ResetCommercialDomain(context.Background(), testutil.Pool(t)); err != nil {
			t.Errorf("reset after suite: %v", err)
		}
	})
	suite := godog.TestSuite{
		ScenarioInitializer: initScenario(t),
		Options: &godog.Options{
			Format:   "pretty",
			Paths:    []string{"features"},
			TestingT: t,
			Strict:   true,
		},
	}
	if status := suite.Run(); status != 0 {
		t.Fatalf("godog suite failed status=%d", status)
	}
}
