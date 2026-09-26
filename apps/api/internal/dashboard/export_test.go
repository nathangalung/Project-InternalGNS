package dashboard

import (
	"bytes"
	"errors"
	"testing"
	"time"

	"github.com/xuri/excelize/v2"

	"github.com/nathangalung/internalgns/apps/api/internal/shared/tz"
)

// wibFirstOfMonth is 30 September UTC.
// 00:30 WIB on 1 October is still 30 September in UTC.
var wibFirstOfMonth = time.Date(2026, 10, 1, 0, 30, 0, 0, tz.Jakarta())

func TestParseRange_DefaultWindowFollowsWIB(t *testing.T) {
	cases := []struct {
		name     string
		now      time.Time
		from, to string
	}{
		{"00:30 WIB on the 1st", wibFirstOfMonth, "2025-11-01", "2026-11-01"},
		{"same instant read in UTC", wibFirstOfMonth.UTC(), "2025-11-01", "2026-11-01"},
		{"23:59 WIB on the last day", time.Date(2026, 9, 30, 23, 59, 0, 0, tz.Jakarta()), "2025-10-01", "2026-10-01"},
		{"December rolls the year", time.Date(2026, 12, 15, 9, 0, 0, 0, tz.Jakarta()), "2026-01-01", "2027-01-01"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			from, to, err := parseRange(tc.now, "", "")
			if err != nil {
				t.Fatalf("parseRange: %v", err)
			}
			if got := from.Format(time.DateOnly); got != tc.from {
				t.Errorf("from = %s, want %s", got, tc.from)
			}
			if got := to.Format(time.DateOnly); got != tc.to {
				t.Errorf("to = %s, want %s", got, tc.to)
			}
		})
	}
}

func TestExportRange(t *testing.T) {
	cases := []struct {
		name, year, from, to, file string
		wantErr                    bool
	}{
		{name: "a chosen year", year: "2025", from: "2025-01-01", to: "2026-01-01", file: "dashboard-export-2025"},
		{name: "default window", year: "", from: "2025-11-01", to: "2026-11-01", file: "dashboard-export-2025-11_2026-10"},
		{name: "not a number", year: "nope", wantErr: true},
		{name: "before 2000", year: "1999", wantErr: true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			from, to, file, err := exportRange(wibFirstOfMonth, tc.year)
			if tc.wantErr {
				if err == nil {
					t.Fatal("want an error")
				}
				return
			}
			if err != nil {
				t.Fatalf("exportRange: %v", err)
			}
			if got := from.Format(time.DateOnly); got != tc.from {
				t.Errorf("from = %s, want %s", got, tc.from)
			}
			if got := to.Format(time.DateOnly); got != tc.to {
				t.Errorf("to = %s, want %s", got, tc.to)
			}
			if file != tc.file {
				t.Errorf("file = %s, want %s", file, tc.file)
			}
		})
	}
}

func TestMonthLabels(t *testing.T) {
	cases := []struct {
		name        string
		from, to    time.Time
		first, last string
		n           int
	}{
		{"a calendar year", time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC), time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC), "2025-01", "2025-12", 12},
		{"a window across years", time.Date(2025, 11, 1, 0, 0, 0, 0, time.UTC), time.Date(2026, 11, 1, 0, 0, 0, 0, time.UTC), "2025-11", "2026-10", 12},
		{"one month", time.Date(2026, 2, 1, 0, 0, 0, 0, time.UTC), time.Date(2026, 3, 1, 0, 0, 0, 0, time.UTC), "2026-02", "2026-02", 1},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := monthLabels(tc.from, tc.to)
			if len(got) != tc.n || got[0] != tc.first || got[len(got)-1] != tc.last {
				t.Errorf("monthLabels = %v, want %d months %s..%s", got, tc.n, tc.first, tc.last)
			}
		})
	}
}

func TestBuildDashboardWorkbook(t *testing.T) {
	s := Summary{
		TotalRevenue: "1500000", TotalExpenses: "900000", TotalProfit: "600000",
		TotalPpn: "165000", TotalQuotations: 12, TotalPo: 8, TotalInvoices: 6,
	}
	months := []string{"2026-01", "2026-02"}
	series := map[string]map[string]string{
		"quotation": {"2026-01": "5", "2026-02": "7"},
		"invoice":   {"2026-01": "2", "2026-02": "4"},
		"revenue":   {"2026-01": "1000000", "2026-02": "500000"},
		"profit":    {"2026-01": "400000"},
		"ppn":       {"2026-02": "60000"},
	}

	var buf bytes.Buffer
	if err := buildDashboardWorkbook(&buf, s, months, series); err != nil {
		t.Fatalf("build: %v", err)
	}
	f, err := excelize.OpenReader(&buf)
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	defer func() { _ = f.Close() }()

	if v, _ := f.GetCellValue("Ringkasan", "A2"); v != "Total Pendapatan" {
		t.Errorf("Ringkasan A2 = %q, want Total Pendapatan", v)
	}
	if v, _ := f.GetCellValue("Ringkasan", "B2"); v != "1500000" {
		t.Errorf("Ringkasan B2 = %q, want 1500000", v)
	}
	rows, _ := f.GetRows("Bulanan")
	if len(rows) != 3 { // header + 2 months
		t.Fatalf("Bulanan rows = %d, want 3", len(rows))
	}
	if rows[0][0] != "Bulan" || rows[0][1] != "Quotation" {
		t.Errorf("Bulanan header = %v", rows[0])
	}
	if v, _ := f.GetCellValue("Ringkasan", "A12"); v != "Invoice Terlambat" {
		t.Errorf("Ringkasan A12 = %q, want Invoice Terlambat", v)
	}
	// Missing metric for a month falls back to 0.
	if v, _ := f.GetCellValue("Bulanan", "F2"); v != "0" { // ppn 2026-01 absent
		t.Errorf("Bulanan F2 (ppn jan) = %q, want 0", v)
	}
}

var errSink = errors.New("connection reset")

type failingWriter struct{}

func (failingWriter) Write([]byte) (int, error) { return 0, errSink }

// Sink failure fails the build.
// A writer that refuses the bytes must surface its error, not report a
// workbook that never left the process.
func TestBuildDashboardWorkbook_SinkFailure(t *testing.T) {
	err := buildDashboardWorkbook(failingWriter{}, Summary{}, []string{"2026-01"}, nil)
	if !errors.Is(err, errSink) {
		t.Fatalf("err = %v, want wrapped %v", err, errSink)
	}
}
