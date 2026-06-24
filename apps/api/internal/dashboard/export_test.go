package dashboard

import (
	"bytes"
	"testing"

	"github.com/xuri/excelize/v2"
)

func TestExportRange(t *testing.T) {
	from, to, err := exportRange("2026")
	if err != nil {
		t.Fatalf("year 2026: %v", err)
	}
	if from.Year() != 2026 || from.Month() != 1 || from.Day() != 1 {
		t.Errorf("from = %v, want 2026-01-01", from)
	}
	if to.Year() != 2027 || to.Month() != 1 {
		t.Errorf("to = %v, want 2027-01-01 (exclusive)", to)
	}
	if _, _, err := exportRange("nope"); err == nil {
		t.Error("expected error for non-numeric year")
	}
	if _, _, err := exportRange(""); err != nil {
		t.Errorf("empty year should default, got %v", err)
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

	data, err := buildDashboardWorkbook(s, months, series)
	if err != nil {
		t.Fatalf("build: %v", err)
	}
	f, err := excelize.OpenReader(bytes.NewReader(data))
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
	// Missing metric for a month falls back to 0.
	if v, _ := f.GetCellValue("Bulanan", "F2"); v != "0" { // ppn 2026-01 absent
		t.Errorf("Bulanan F2 (ppn jan) = %q, want 0", v)
	}
}
