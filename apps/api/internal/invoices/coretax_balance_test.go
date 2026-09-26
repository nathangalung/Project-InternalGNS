package invoices

import (
	"bytes"
	"testing"
	"time"

	"github.com/shopspring/decimal"
	"github.com/xuri/excelize/v2"

	"github.com/nathangalung/internalgns/apps/api/internal/clients"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/deps"
)

// Coretax lines balance (INV-11).
// DJP validates Price * Qty - TotalDiscount = TaxBase per line, so a line
// filed with the net price and no discount is off by the rounding of that
// net price.
func TestBuildGoodService_LineBalances(t *testing.T) {
	t.Parallel()
	ptr := func(s string) *string { return &s }
	cases := []struct {
		name      string
		item      InvoiceItem
		wantPrice string
		wantDisc  string
		balances  bool
	}{
		{
			name:      "discounted line files the gross price and its discount",
			item:      InvoiceItem{Qty: "3", UnitPrice: "90000.00", GrossUnitPrice: ptr("100000.00"), Dpp: ptr("270000.00")},
			wantPrice: "100000",
			wantDisc:  "30000",
			balances:  true,
		},
		{
			// 3 x 26646.07 at 10% off: the net unit 23981.463 is stored as
			// 23981.46, so net x qty is 71944.38 against a DPP of 71944.39.
			name:      "a rounded net price still balances",
			item:      InvoiceItem{Qty: "3", UnitPrice: "23981.46", GrossUnitPrice: ptr("26646.07"), Dpp: ptr("71944.39")},
			wantPrice: "26646.07",
			wantDisc:  "7993.82",
			balances:  true,
		},
		{
			name:      "an undiscounted shipping line has no discount",
			item:      InvoiceItem{Qty: "1", UnitPrice: "75000.00", GrossUnitPrice: ptr("75000.00"), Dpp: ptr("75000.00")},
			wantPrice: "75000",
			wantDisc:  "0",
			balances:  true,
		},
		{
			name:      "a legacy line without a gross price files the net price",
			item:      InvoiceItem{Qty: "3", UnitPrice: "90000.00", Dpp: ptr("270000.00")},
			wantPrice: "90000",
			wantDisc:  "0",
			balances:  true,
		},
		{
			// Net x qty falls a cent short of the DPP; a negative discount
			// is never filed.
			name:      "a legacy rounding shortfall never files a negative discount",
			item:      InvoiceItem{Qty: "3", UnitPrice: "23981.46", Dpp: ptr("71944.39")},
			wantPrice: "23981.46",
			wantDisc:  "0",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			gs := buildGoodService(tc.item)
			if gs.Price != tc.wantPrice {
				t.Errorf("Price = %s, want %s", gs.Price, tc.wantPrice)
			}
			if gs.TotalDiscount != tc.wantDisc {
				t.Errorf("TotalDiscount = %s, want %s", gs.TotalDiscount, tc.wantDisc)
			}
			if gs.TaxBase != normalizeMoneyPtr(tc.item.Dpp) {
				t.Errorf("TaxBase = %s, want the stored DPP %s", gs.TaxBase, *tc.item.Dpp)
			}
			if !tc.balances {
				return
			}
			filed := decimal.RequireFromString(gs.Price).
				Mul(decimal.RequireFromString(gs.Qty)).
				Sub(decimal.RequireFromString(gs.TotalDiscount))
			if !filed.Equal(decimal.RequireFromString(gs.TaxBase)) {
				t.Errorf("Price*Qty - TotalDiscount = %s, want TaxBase %s", filed, gs.TaxBase)
			}
		})
	}
}

// Bulk workbook lines balance too.
func TestBuildCoretaxWorkbook_LineBalances(t *testing.T) {
	t.Parallel()
	ptr := func(s string) *string { return &s }
	settings := deps.CoretaxSettings{SellerTIN: "0626381321011000", SellerIDTKU: "0626381321011000000000"}
	invs := []Invoice{{ID: 1, InvoiceNo: "INV-BAL/GNS/IX/2026", CompanyClientID: 10,
		InvoiceDate: time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC)}}
	items := map[int64][]InvoiceItem{1: {{
		ItemName: "Ball valve", Qty: "3", UnitPrice: "23981.46", GrossUnitPrice: ptr("26646.07"),
		Dpp: ptr("71944.39"), DppNilaiLain: ptr("65949.02"), PpnRate: ptr("12"), PpnAmount: ptr("7913.88"),
	}}}
	buyers := map[int64]clients.Client{10: {Name: "PT. Balance Buyer", NPWP: ptr("0000000000000000"), CountryCode: "IDN"}}

	out, err := buildCoretaxWorkbook(loadTemplate(t), settings, invs, items, buyers)
	if err != nil {
		t.Fatalf("build: %v", err)
	}
	f, err := excelize.OpenReader(bytes.NewReader(out))
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	defer func() { _ = f.Close() }()
	rows, err := f.GetRows(coretaxSheetDetail)
	if err != nil || len(rows) != 2 {
		t.Fatalf("detail rows = %d (%v), want header plus one line", len(rows), err)
	}
	// Columns F Harga Satuan, G Jumlah, H Total Diskon, I DPP.
	line := rows[1]
	want := map[int]string{5: "26646.07", 6: "3", 7: "7993.82", 8: "71944.39"}
	for col, v := range want {
		if line[col] != v {
			t.Errorf("column %d = %q, want %q", col, line[col], v)
		}
	}
	filed := decimal.RequireFromString(line[5]).Mul(decimal.RequireFromString(line[6])).
		Sub(decimal.RequireFromString(line[7]))
	if !filed.Equal(decimal.RequireFromString(line[8])) {
		t.Errorf("Harga x Jumlah - Diskon = %s, want DPP %s", filed, line[8])
	}
}
