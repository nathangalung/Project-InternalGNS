package quotations

import (
	"testing"
	"time"
)

func qStr(s string) *string { return &s }

func qInt16(v int16) *int16 { return &v }

func qInt64(v int64) *int64 { return &v }

// productLine builds a product line.
// The line is priced and catalog-linked.
func productLine(n int16, name, qty, price, total string) QuotationItem {
	return QuotationItem{
		LineNumber:    n,
		ItemType:      "product",
		RequestedName: name,
		Qty:           qty,
		UnitID:        qInt16(19),
		SellingPrice:  price,
		TotalSelling:  total,
		IsAvailable:   true,
		OfferedItemID: qInt64(1),
	}
}

// shippingLine mirrors fn_create_quotation's shipping.
func shippingLine(n int16, cost string) QuotationItem {
	return QuotationItem{
		LineNumber:    n,
		ItemType:      "shipping",
		RequestedName: "SHIPPING — Tanjung Priok",
		Qty:           "1.00",
		UnitID:        qInt16(18),
		SellingPrice:  cost,
		TotalSelling:  cost,
		IsAvailable:   true,
	}
}

// header mirrors stored quotation columns.
func header(totalProduk, total, totalDiscount, subtotal, dpp, ppn, grand string) Quotation {
	return Quotation{
		QuotationNo:       "Q-26090193/GNS/IX/2026",
		CompanyClientName: "PT. Pelita Global",
		DiscountPct:       "10.00",
		TotalProduk:       totalProduk,
		Total:             total,
		TotalDiscount:     totalDiscount,
		Subtotal:          subtotal,
		DppNilaiLain:      dpp,
		PpnAmount:         ppn,
		GrandTotal:        grand,
		CreatedAt:         time.Date(2026, 9, 23, 3, 0, 0, 0, time.UTC),
	}
}

var qUnits = map[int16]string{19: "SET", 18: "UNIT"}

// Printed totals reconcile with header.
// They come from the stored header.
func TestBuildExportData_TotalsFromStoredHeader(t *testing.T) {
	// 2 x 1.000,50 = 2.001,00 product, 10% discount, 150,25 shipping.
	// subtotal = 2001,00 + 150,25 - 200,10 = 1.951,15
	// dpp = 1951,15 * 11 / 12 = 1.788,55  (rounded to 2dp by the DB)
	// ppn = dpp * 0,12 = 214,63
	// grand = 1951,15 * 1,11 = 2.165,78
	d := QuotationDetail{
		Quotation: header("2001.00", "2151.25", "200.10", "1951.15", "1788.55", "214.63", "2165.78"),
		Items: []QuotationItem{
			productLine(1, "PUNCHING TOOL SET", "2.00", "1000.50", "2001.00"),
			shippingLine(2, "150.25"),
		},
	}

	got := buildExportData(d, qUnits, "", "", "Director")

	checks := []struct {
		field, got, want string
	}{
		{"TotalProduk", got.TotalProduk, "Rp~2.001,00"},
		{"TotalDiscount", got.TotalDiscount, "Rp~200,10"},
		{"Shipping", got.Shipping, "Rp~150,25"},
		{"Subtotal", got.Subtotal, "Rp~1.951,15"},
		{"DPP", got.DPP, "Rp~1.788,55"},
		{"PPN", got.PPN, "Rp~214,63"},
		{"GrandTotal", got.GrandTotal, "Rp~2.165,78"},
	}
	for _, c := range checks {
		if c.got != c.want {
			t.Errorf("%s = %q, want %q", c.field, c.got, c.want)
		}
	}
	if !got.HasShipping {
		t.Error("HasShipping = false, want true")
	}
	if len(got.Items) != 2 {
		t.Fatalf("items = %d, want 2", len(got.Items))
	}
	if !got.Items[1].HasOffer {
		t.Error("the shipping line must print its amount, not No Offer")
	}
	if got.Items[1].Amount != "Rp~150,25" {
		t.Errorf("shipping amount = %q, want Rp~150,25", got.Items[1].Amount)
	}
}

// Uncharged shipping prints no row.
// A line kept only for its address must not read as a Rp 0 charge, in the
// item table or in the totals; its delivery days still print.
func TestBuildExportData_ZeroCostShipping(t *testing.T) {
	for _, cost := range []string{"0.00", "0"} {
		t.Run(cost, func(t *testing.T) {
			three := 3
			ship := shippingLine(2, cost)
			ship.ShippingDays = &three
			d := QuotationDetail{
				Quotation: header("1000.00", "1000.00", "0.00", "1000.00", "916.67", "110.00", "1110.00"),
				Items:     []QuotationItem{productLine(1, "ITEM", "1.00", "1000.00", "1000.00"), ship},
			}

			got := buildExportData(d, qUnits, "", "", "Director")

			if got.HasShipping {
				t.Error("HasShipping = true for a Rp 0 shipping line")
			}
			if len(got.Items) != 1 {
				t.Fatalf("items = %d, want 1 (the Rp 0 shipping line is not printed)", len(got.Items))
			}
			if got.DeliveryTime != "3 days" {
				t.Errorf("DeliveryTime = %q, want 3 days", got.DeliveryTime)
			}
		})
	}
}

// Unpriced lines print No Offer.
// A priced line is quoted.
func TestBuildExportData_NoOfferIsUnpriced(t *testing.T) {
	// Unpriced lines add nothing to total_produk, so the printed lines
	// still sum to the stored header. Catalog linking does not matter.
	linkedUnpriced := productLine(2, "FIRE HOSE COUPLING", "1.00", "0.00", "0.00")
	pricedUnlinked := productLine(3, "KABEL NYM 3x2.5", "1.00", "500.00", "500.00")
	pricedUnlinked.OfferedItemID = nil

	d := QuotationDetail{
		Quotation: header("1500.00", "1500.00", "0.00", "1500.00", "1375.00", "165.00", "1665.00"),
		Items: []QuotationItem{
			productLine(1, "PUNCHING TOOL SET", "1.00", "1000.00", "1000.00"),
			linkedUnpriced,
			pricedUnlinked,
		},
	}

	got := buildExportData(d, qUnits, "", "", "Director")

	cases := []struct {
		line     int
		hasOffer bool
	}{{0, true}, {1, false}, {2, true}}
	for _, c := range cases {
		if got.Items[c.line].HasOffer != c.hasOffer {
			t.Errorf("line %d: HasOffer = %v, want %v", c.line+1, got.Items[c.line].HasOffer, c.hasOffer)
		}
	}
	if got.TotalProduk != "Rp~1.500,00" {
		t.Errorf("TotalProduk = %q, want Rp~1.500,00", got.TotalProduk)
	}
	if got.HasShipping {
		t.Error("HasShipping = true with no shipping line")
	}
}

// Offer column describes supplied item.
// It names the catalog item actually supplied.
func TestBuildExportData_OfferShowsOfferedItem(t *testing.T) {
	offered := productLine(1, "LAMPU LED 12W", "1.00", "1000.00", "1000.00")
	offered.RequestedImpa = qStr("790268")
	offered.OfferedName = qStr("LAMP LED 12W (100W) 220V E-27, COOL WHITE")
	offered.OfferedImpa = qStr("790269")

	fallback := productLine(2, "KABEL NYM 3x2.5", "1.00", "500.00", "500.00")

	d := QuotationDetail{
		Quotation: header("1500.00", "1500.00", "0.00", "1500.00", "1375.00", "165.00", "1665.00"),
		Items:     []QuotationItem{offered, fallback},
	}

	got := buildExportData(d, qUnits, "", "", "Director")

	wantOffer := `LAMP LED 12W (100W) 220V E-27, COOL WHITE (790269)`
	if got.Items[0].Offer != wantOffer {
		t.Errorf("Offer = %q, want %q", got.Items[0].Offer, wantOffer)
	}
	if got.Items[0].Request != "LAMPU LED 12W (790268)" {
		t.Errorf("Request = %q, want the client request text", got.Items[0].Request)
	}
	if got.Items[1].Offer != "KABEL NYM 3x2.5" {
		t.Errorf("Offer = %q, want the request text as fallback", got.Items[1].Offer)
	}
}

// Six product lines need A4.
// Five still fit A5.
func TestBuildExportData_PaperSize(t *testing.T) {
	cases := []struct {
		products int
		wantA4   bool
	}{{1, false}, {5, false}, {6, true}}
	for _, tc := range cases {
		items := make([]QuotationItem, 0, tc.products+1)
		for i := 0; i < tc.products; i++ {
			items = append(items, productLine(int16(i+1), "ITEM", "1.00", "1000.00", "1000.00"))
		}
		items = append(items, shippingLine(int16(tc.products+1), "100.00"))
		d := QuotationDetail{
			Quotation: header("1000.00", "1100.00", "0.00", "1100.00", "1008.33", "121.00", "1221.00"),
			Items:     items,
		}
		if got := buildExportData(d, qUnits, "", "", "Director").UseA4; got != tc.wantA4 {
			t.Errorf("%d products: UseA4 = %v, want %v", tc.products, got, tc.wantA4)
		}
	}
}

// Footer terms follow stored data.
func TestBuildExportData_FooterTerms(t *testing.T) {
	withDays := func(days *int) QuotationItem {
		s := shippingLine(2, "100.00")
		s.ShippingDays = days
		return s
	}
	one, three := 1, 3
	product := productLine(1, "ITEM", "1.00", "1000.00", "1000.00")

	cases := []struct {
		name         string
		vessel       *string
		payment      *string
		validity     *int
		items        []QuotationItem
		wantPlace    string
		wantTime     string
		wantPayment  string
		wantValidity string
	}{
		{
			name:   "every term set",
			vessel: qStr("MV Global Star & Co"), payment: qStr("30 hari"), validity: &three,
			items:     []QuotationItem{product, withDays(&three)},
			wantPlace: `MV Global Star \& Co`, wantTime: "3 days", wantPayment: "30 hari", wantValidity: "3 days",
		},
		{
			name:     "one day is singular",
			validity: &one,
			items:    []QuotationItem{product, withDays(&one)},
			wantTime: "1 day", wantValidity: "1 day",
		},
		{
			name:  "shipping line without days",
			items: []QuotationItem{product, withDays(nil)},
		},
		{
			name:  "no shipping line",
			items: []QuotationItem{product},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			h := header("1000.00", "1100.00", "0.00", "1100.00", "1008.33", "121.00", "1221.00")
			h.VesselName, h.PaymentTerms, h.ValidityDays = tc.vessel, tc.payment, tc.validity
			got := buildExportData(QuotationDetail{Quotation: h, Items: tc.items}, qUnits, "", "", "Director")

			checks := []struct{ field, got, want string }{
				{"DeliveryPlace", got.DeliveryPlace, tc.wantPlace},
				{"DeliveryTime", got.DeliveryTime, tc.wantTime},
				{"Payment", got.Payment, tc.wantPayment},
				{"Validity", got.Validity, tc.wantValidity},
			}
			for _, c := range checks {
				if c.got != c.want {
					t.Errorf("%s = %q, want %q", c.field, c.got, c.want)
				}
			}
		})
	}
}
