package dashboard

import (
	"bytes"
	"errors"
	"net/http"
	"sort"
	"strconv"
	"time"

	"github.com/xuri/excelize/v2"

	"github.com/nathangalung/internalgns/apps/api/internal/shared/deps"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/httperr"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/httpx"
)

var errInvalidYear = errors.New("invalid year")

// exportMetrics drives both the monthly columns and their order.
var exportMetrics = []struct{ key, header string }{
	{"quotation", "Quotation"},
	{"invoice", "Invoice"},
	{"revenue", "Pendapatan"},
	{"profit", "Laba Bersih"},
	{"ppn", "PPN"},
}

// Export writes the dashboard summary + monthly series as XLSX.
// GET /dashboard/export.xlsx?year=YYYY (year optional; defaults to last 12 months).
func (h *Handler) Export(w http.ResponseWriter, r *http.Request) {
	if !canViewFinancial(deps.CurrentUserRole(r.Context())) {
		httperr.Render(w, httperr.Forbidden("insufficient role"))
		return
	}
	from, to, err := exportRange(r.URL.Query().Get("year"))
	if err != nil {
		httperr.Render(w, httperr.BadRequest(err.Error()))
		return
	}

	summary, err := h.repo.Summary(r.Context())
	if err != nil {
		httperr.RenderDBErr(w, err)
		return
	}

	// Collect each metric's monthly points keyed by month label.
	series := make(map[string]map[string]string, len(exportMetrics))
	monthsSet := map[string]struct{}{}
	for _, m := range exportMetrics {
		points, err := h.repo.Timeseries(r.Context(), m.key, from, to)
		if err != nil {
			httperr.RenderDBErr(w, err)
			return
		}
		byMonth := make(map[string]string, len(points))
		for _, p := range points {
			byMonth[p.Month] = p.Value
			monthsSet[p.Month] = struct{}{}
		}
		series[m.key] = byMonth
	}
	months := make([]string, 0, len(monthsSet))
	for m := range monthsSet {
		months = append(months, m)
	}
	sort.Strings(months)

	data, err := buildDashboardWorkbook(summary, months, series)
	if err != nil {
		httperr.Render(w, httperr.Internal("dashboard workbook build failed"))
		return
	}
	httpx.WriteXLSX(w, "dashboard-export", data)
}

// exportRange maps an optional year to [from, to). Empty year => last 12 months.
func exportRange(year string) (time.Time, time.Time, error) {
	if year == "" {
		return parseRange("", "")
	}
	y, err := strconv.Atoi(year)
	if err != nil || y < 2000 || y > 9999 {
		return time.Time{}, time.Time{}, errInvalidYear
	}
	from := time.Date(y, 1, 1, 0, 0, 0, 0, time.UTC)
	return from, from.AddDate(1, 0, 0), nil
}

func buildDashboardWorkbook(
	s Summary,
	months []string,
	series map[string]map[string]string,
) ([]byte, error) {
	f := excelize.NewFile()
	defer func() { _ = f.Close() }()

	const sumSheet = "Ringkasan"
	_ = f.SetSheetName("Sheet1", sumSheet)
	summaryRows := [][]any{
		{"Metrik", "Nilai"},
		{"Total Pendapatan", num(s.TotalRevenue)},
		{"Total Pengeluaran", num(s.TotalExpenses)},
		{"Total Laba Bersih", num(s.TotalProfit)},
		{"Total PPN", num(s.TotalPpn)},
		{"Total Quotation", s.TotalQuotations},
		{"Total Quotation Ditolak", s.TotalQuotationsRejected},
		{"Total Purchase Order", s.TotalPo},
		{"Total Invoice", s.TotalInvoices},
		{"Total Invoice Dibayar", s.TotalInvoicesPaid},
		{"Invoice Akan Jatuh Tempo", s.InvoicesDueSoon},
		{"Invoice Jatuh Tempo", s.InvoicesOverdue},
	}
	writeGrid(f, sumSheet, summaryRows)

	const monthSheet = "Bulanan"
	if _, err := f.NewSheet(monthSheet); err != nil {
		return nil, err
	}
	header := []any{"Bulan"}
	for _, m := range exportMetrics {
		header = append(header, m.header)
	}
	monthRows := [][]any{header}
	for _, mon := range months {
		row := []any{mon}
		for _, m := range exportMetrics {
			row = append(row, num(series[m.key][mon]))
		}
		monthRows = append(monthRows, row)
	}
	writeGrid(f, monthSheet, monthRows)

	var buf bytes.Buffer
	if err := f.Write(&buf); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func writeGrid(f *excelize.File, sheet string, rows [][]any) {
	for r, row := range rows {
		for c, v := range row {
			cell, _ := excelize.CoordinatesToCellName(c+1, r+1)
			_ = f.SetCellValue(sheet, cell, v)
		}
	}
}

// num parses a decimal string to float so the cell is numeric; 0 on failure.
func num(s string) float64 {
	v, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return 0
	}
	return v
}
