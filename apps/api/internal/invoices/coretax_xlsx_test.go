package invoices

import (
	"bytes"
	"os"
	"testing"
	"time"

	"github.com/xuri/excelize/v2"

	"github.com/nathangalung/internalgns/apps/api/internal/clients"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/deps"
)

func sptr(s string) *string { return &s }

// loadTemplate reads the bundled DJP workbook from the repo.
func loadTemplate(t *testing.T) []byte {
	t.Helper()
	b, err := os.ReadFile("../../templates/documents/coretax/coretax_export_2026.xlsx")
	if err != nil {
		t.Fatalf("read template: %v", err)
	}
	return b
}

func TestBuildCoretaxWorkbook_ClearsSampleAndFills(t *testing.T) {
	tmpl := loadTemplate(t)
	settings := deps.CoretaxSettings{SellerTIN: "0626381321011000", SellerIDTKU: "0626381321011000000000"}

	invs := []Invoice{
		{
			ID: 1, InvoiceNo: "INV-A/GNS/V/2026", CompanyClientID: 10,
			InvoiceDate: time.Date(2026, 5, 1, 0, 0, 0, 0, time.UTC),
		},
		{
			ID: 2, InvoiceNo: "INV-B/GNS/V/2026", CompanyClientID: 10,
			InvoiceDate: time.Date(2026, 5, 2, 0, 0, 0, 0, time.UTC),
		},
	}
	itemsByID := map[int64][]InvoiceItem{
		1: {
			{ItemName: "Life jacket", Qty: "4", UnitPrice: "1450000",
				Dpp: sptr("5510000"), DppNilaiLain: sptr("5050833.33"),
				PpnRate: sptr("12"), PpnAmount: sptr("606100"),
				UnitCoretaxCode: sptr("UM.0021")},
			{ItemName: "Beacon", Qty: "1", UnitPrice: "2000000",
				Dpp: sptr("2000000"), DppNilaiLain: sptr("1833333.33"),
				PpnRate: sptr("12"), PpnAmount: sptr("220000"),
				UnitCoretaxCode: sptr("UM.0021")},
		},
		2: {
			{ItemName: "Manual", Qty: "1", UnitPrice: "16400000",
				Dpp: sptr("15580000"), DppNilaiLain: sptr("14281666.67"),
				PpnRate: sptr("12"), PpnAmount: sptr("1713800"),
				UnitCoretaxCode: sptr("UM.0021")},
		},
	}
	clientsByID := map[int64]clients.Client{
		10: {Name: "PT. Test Buyer", NPWP: sptr("0000000000000000"),
			Address: sptr("Jakarta"), CountryCode: "IDN"},
	}

	out, err := buildCoretaxWorkbook(tmpl, settings, invs, itemsByID, clientsByID)
	if err != nil {
		t.Fatalf("build: %v", err)
	}

	f, err := excelize.OpenReader(bytes.NewReader(out))
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	defer func() { _ = f.Close() }()

	// REF + Keterangan sheets must survive.
	for _, s := range []string{"REF", "Keterangan"} {
		if idx, _ := f.GetSheetIndex(s); idx < 0 {
			t.Fatalf("sheet %s missing from output", s)
		}
	}

	fakturRows, _ := f.GetRows(coretaxSheetFaktur)
	// Rows: 1 NPWP header, 2 blank, 3 header, then one row per invoice.
	dataFaktur := 0
	for i, row := range fakturRows {
		if i < 3 || len(row) == 0 || row[0] == "" {
			continue
		}
		dataFaktur++
	}
	if dataFaktur != len(invs) {
		t.Fatalf("Faktur data rows = %d, want %d (sample rows leaked?)", dataFaktur, len(invs))
	}

	detailRows, _ := f.GetRows(coretaxSheetDetail)
	totalLines := 0
	for _, items := range itemsByID {
		totalLines += len(items)
	}
	dataDetail := len(detailRows) - 1 // minus header
	if dataDetail != totalLines {
		t.Fatalf("DetailFaktur data rows = %d, want %d", dataDetail, totalLines)
	}

	// NPWP header populated.
	if v, _ := f.GetCellValue(coretaxSheetFaktur, "C1"); v != settings.SellerTIN {
		t.Fatalf("NPWP header = %q, want %q", v, settings.SellerTIN)
	}

	// Last DetailFaktur row's invoice number must be one we exported.
	lastInv := detailRows[len(detailRows)-1][14]
	if lastInv != "INV-B/GNS/V/2026" {
		t.Fatalf("last detail Nomor Invoice = %q, want exported invoice", lastInv)
	}

	// Spot-check first line's DPP (col I, index 8) and PPN (col L, index 11).
	first := detailRows[1]
	if first[8] != "5510000" {
		t.Fatalf("first line DPP = %q, want 5510000", first[8])
	}
	if first[11] != "606100" {
		t.Fatalf("first line PPN = %q, want 606100", first[11])
	}
	// Decimal DPP Nilai Lain (col J, index 9) must survive without scientific
	// notation or precision loss.
	if first[9] != "5050833.33" {
		t.Fatalf("first line DPP Nilai Lain = %q, want 5050833.33", first[9])
	}
}

func TestBuildCoretaxWorkbook_EmptySellerTIN(t *testing.T) {
	tmpl := loadTemplate(t)
	out, err := buildCoretaxWorkbook(tmpl, deps.CoretaxSettings{}, nil, nil, nil)
	if err != nil {
		t.Fatalf("build with empty TIN: %v", err)
	}
	f, _ := excelize.OpenReader(bytes.NewReader(out))
	defer func() { _ = f.Close() }()
	if v, _ := f.GetCellValue(coretaxSheetFaktur, "C1"); v != "" {
		t.Fatalf("NPWP header = %q, want empty", v)
	}
	rows, _ := f.GetRows(coretaxSheetFaktur)
	for i, row := range rows {
		if i >= 3 && len(row) > 0 && row[0] != "" {
			t.Fatalf("expected no data rows, found %v", row)
		}
	}
}
