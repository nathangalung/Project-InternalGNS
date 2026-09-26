package dashboard

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"time"

	"github.com/xuri/excelize/v2"

	"github.com/nathangalung/internalgns/apps/api/internal/shared/deps"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/httperr"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/httpx"
)

var errInvalidYear = errors.New("invalid year")

// exportMetrics orders the monthly columns.
var exportMetrics = []struct{ key, header string }{
	{"quotation", "Quotation"},
	{"invoice", "Invoice"},
	{"revenue", "Pendapatan"},
	{"profit", "Laba Bersih"},
	{"ppn", "PPN"},
}

// Export writes the dashboard XLSX.
// It holds the summary plus the monthly series.
// GET /dashboard/export.xlsx?year=YYYY (year optional; defaults to the last
// 12 WIB months). Both sheets cover the same window, so each Ringkasan
// total equals the sum of its Bulanan column.
func (h *Handler) Export(w http.ResponseWriter, r *http.Request) {
	if !canViewFinancial(deps.CurrentUserRole(r.Context())) {
		httperr.Render(w, httperr.Forbidden("insufficient role"))
		return
	}
	from, to, name, err := exportRange(h.now(), r.URL.Query().Get("year"))
	if err != nil {
		httperr.Render(w, httperr.BadRequest(err.Error()))
		return
	}

	summary, err := h.repo.Totals(r.Context(), &from, &to)
	if err != nil {
		httperr.RenderDBErrCtx(r.Context(), w, err)
		return
	}

	// Collect each metric's monthly points keyed by month label.
	series := make(map[string]map[string]string, len(exportMetrics))
	for _, m := range exportMetrics {
		points, err := h.repo.Timeseries(r.Context(), m.key, from, to, "month")
		if err != nil {
			httperr.RenderDBErrCtx(r.Context(), w, err)
			return
		}
		byMonth := make(map[string]string, len(points))
		for _, p := range points {
			byMonth[p.Month] = p.Value
		}
		series[m.key] = byMonth
	}

	var buf bytes.Buffer
	if err := buildDashboardWorkbook(&buf, summary, monthLabels(from, to), series); err != nil {
		httperr.Render(w, httperr.Internal("dashboard workbook build failed"))
		return
	}
	httpx.WriteXLSX(w, name, buf.Bytes())
}

// exportRange maps year to window.
// It returns [from, to) and a file name.
// An empty year is the default chart window.
func exportRange(now time.Time, year string) (time.Time, time.Time, string, error) {
	if year == "" {
		from, to, err := parseRange(now, "", "")
		last := to.AddDate(0, -1, 0)
		name := "dashboard-export-" + from.Format("2006-01") + "_" + last.Format("2006-01")
		return from, to, name, err
	}
	y, err := strconv.Atoi(year)
	if err != nil || y < 2000 || y > 9999 {
		return time.Time{}, time.Time{}, "", errInvalidYear
	}
	from := time.Date(y, 1, 1, 0, 0, 0, 0, time.UTC)
	return from, from.AddDate(1, 0, 0), "dashboard-export-" + year, nil
}

// monthLabels lists the window's months.
// They cover every month in [from, to).
// The rows come from the window, not the data, so an empty month still
// gets its zero row.
func monthLabels(from, to time.Time) []string {
	var out []string
	for m := time.Date(from.Year(), from.Month(), 1, 0, 0, 0, 0, time.UTC); m.Before(to); m = m.AddDate(0, 1, 0) {
		out = append(out, m.Format("2006-01"))
	}
	return out
}

// buildDashboardWorkbook writes both sheets.
func buildDashboardWorkbook(
	w io.Writer,
	s Summary,
	months []string,
	series map[string]map[string]string,
) error {
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
		{"Invoice Segera Jatuh Tempo", s.InvoicesDueSoon},
		{"Invoice Terlambat", s.InvoicesOverdue},
	}
	writeGrid(f, sumSheet, summaryRows)

	const monthSheet = "Bulanan"
	if _, err := f.NewSheet(monthSheet); err != nil {
		return err
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

	if err := f.Write(w); err != nil {
		return fmt.Errorf("write dashboard xlsx: %w", err)
	}
	return nil
}

func writeGrid(f *excelize.File, sheet string, rows [][]any) {
	for r, row := range rows {
		for c, v := range row {
			cell, _ := excelize.CoordinatesToCellName(c+1, r+1)
			_ = f.SetCellValue(sheet, cell, v)
		}
	}
}

// num parses a numeric cell.
// It returns 0 on failure.
func num(s string) float64 {
	v, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return 0
	}
	return v
}
