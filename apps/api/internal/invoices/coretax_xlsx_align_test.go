package invoices

import (
	"bytes"
	"testing"
	"time"

	"github.com/xuri/excelize/v2"

	"github.com/nathangalung/internalgns/apps/api/internal/clients"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/deps"
)

// Written cells centre vertically.
// Every cell the export writes sits on its row's middle; the date keeps its
// number format, and the template's REF sheet keeps its own styles.
func TestBuildCoretaxWorkbook_CellsCentred(t *testing.T) {
	tmpl := loadTemplate(t)
	settings := deps.CoretaxSettings{SellerTIN: "0626381321011000", SellerIDTKU: "0626381321011000000000"}
	invs := []Invoice{{
		ID: 1, InvoiceNo: "INV-A/GNS/V/2026", CompanyClientID: 10,
		CompanyName: "PT. Test Buyer", CompanyNpwp: sptr("0000000000000000"), CompanyAddress: sptr("Jakarta"),
		InvoiceDate: time.Date(2026, 5, 1, 0, 0, 0, 0, time.UTC),
	}}
	itemsByID := map[int64][]InvoiceItem{1: {{
		ItemName: "Life jacket", Qty: "4", UnitPrice: "1450000",
		Dpp: sptr("5800000"), DppNilaiLain: sptr("5316666.67"),
		PpnRate: sptr("12"), PpnAmount: sptr("638000"), UnitCoretaxCode: sptr("UM.0021"),
	}}}
	clientsByID := map[int64]clients.Client{10: {
		Name: "PT. Test Buyer", NPWP: sptr("0000000000000000"),
		Address: sptr("Jakarta"), CountryCode: "IDN",
	}}

	out, err := buildCoretaxWorkbook(tmpl, settings, invs, itemsByID, clientsByID)
	if err != nil {
		t.Fatalf("build: %v", err)
	}
	f, err := excelize.OpenReader(bytes.NewReader(out))
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	defer func() { _ = f.Close() }()
	style := func(sheet, cell string) *excelize.Style {
		t.Helper()
		id, err := f.GetCellStyle(sheet, cell)
		if err != nil {
			t.Fatalf("%s %s style: %v", sheet, cell, err)
		}
		s, err := f.GetStyle(id)
		if err != nil {
			t.Fatalf("%s %s style: %v", sheet, cell, err)
		}
		return s
	}

	written := map[string][]string{coretaxSheetFaktur: {"A1", "C1"}}
	for c := range coretaxFakturHeaders {
		for _, row := range []int{3, 4} {
			cell, _ := excelize.CoordinatesToCellName(c+1, row)
			written[coretaxSheetFaktur] = append(written[coretaxSheetFaktur], cell)
		}
	}
	for c := range coretaxDetailHeaders {
		for _, row := range []int{1, 2} {
			cell, _ := excelize.CoordinatesToCellName(c+1, row)
			written[coretaxSheetDetail] = append(written[coretaxSheetDetail], cell)
		}
	}
	for sheet, cells := range written {
		for _, cell := range cells {
			s := style(sheet, cell)
			if s.Alignment == nil || s.Alignment.Vertical != "center" {
				t.Errorf("%s %s alignment = %+v, want vertical center", sheet, cell, s.Alignment)
				continue
			}
			if s.Alignment.Horizontal != "" || s.Alignment.WrapText {
				t.Errorf("%s %s alignment = %+v, want only vertical center", sheet, cell, s.Alignment)
			}
		}
	}
	if got := style(coretaxSheetFaktur, "B4").NumFmt; got != 17 {
		t.Errorf("Faktur B4 number format = %d, want 17", got)
	}
	if v, _ := f.GetCellValue(coretaxSheetDetail, "I2"); v != "5800000" {
		t.Errorf("DetailFaktur I2 = %q, want 5800000", v)
	}

	orig, err := excelize.OpenReader(bytes.NewReader(tmpl))
	if err != nil {
		t.Fatalf("open template: %v", err)
	}
	defer func() { _ = orig.Close() }()
	for _, cell := range []string{"A1", "B2"} {
		before, _ := orig.GetCellStyle("REF", cell)
		after, _ := f.GetCellStyle("REF", cell)
		if before != after {
			t.Errorf("REF %s style = %d, template has %d", cell, after, before)
		}
	}
}
