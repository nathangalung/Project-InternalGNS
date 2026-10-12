package purchaseorders

import (
	"reflect"
	"strings"
	"testing"

	"github.com/nathangalung/internalgns/apps/api/internal/pdfgen"
)

func dnLine(name, qty string, unit, ship *string) PurchaseOrderItem {
	return PurchaseOrderItem{ItemType: "product", ItemName: name, Qty: qty, UnitCode: unit, ShipDestination: ship}
}

func shippingTo(addr *string) PurchaseOrderItem {
	return PurchaseOrderItem{ItemType: "shipping", ItemName: "Pengiriman", Qty: "1.00", ShipDestination: addr}
}

func withNote(it PurchaseOrderItem, note string) PurchaseOrderItem {
	it.DnNote = &note
	return it
}

// Where the goods go.
// The shipping line's address, else the one place every addressed product
// line names, else the client's own address.
func TestDeliveryNoteAddress(t *testing.T) {
	priok, priokTyped, cakung, blank := "Pelabuhan Tanjung Priok, Jakarta Utara", " pelabuhan tanjung priok ,\nJakarta Utara ", "Gudang Cakung", "  "
	const client = "Jl. Rasuna Said Kav. C5, Jakarta"

	tests := []struct {
		name  string
		items []PurchaseOrderItem
		want  string
	}{
		{"no lines take the client address", nil, client},
		{"the shipping line wins", []PurchaseOrderItem{dnLine("A", "1", nil, &cakung), shippingTo(&priok)}, priok},
		{"a blank shipping line falls through", []PurchaseOrderItem{dnLine("A", "1", nil, &cakung), shippingTo(&blank)}, cakung},
		{"one place typed two ways is shared", []PurchaseOrderItem{dnLine("A", "1", nil, &priok), dnLine("B", "1", nil, &priokTyped)}, priok},
		{"unaddressed lines do not split the place", []PurchaseOrderItem{dnLine("A", "1", nil, nil), dnLine("B", "1", nil, &cakung)}, cakung},
		{"two places take the client address", []PurchaseOrderItem{dnLine("A", "1", nil, &priok), dnLine("B", "1", nil, &cakung)}, client},
		{"no addressed line takes the client address", []PurchaseOrderItem{dnLine("A", "1", nil, &blank)}, client},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := deliveryNoteAddress(tc.items, client); got != tc.want {
				t.Errorf("deliveryNoteAddress = %q, want %q", got, tc.want)
			}
		})
	}
}

// The note a line starts with.
// Only a product line whose own destination is not the header Address.
func TestDefaultNote(t *testing.T) {
	priok, priokTyped, cakung, blank := "Pelabuhan Tanjung Priok, Jakarta Utara", "PELABUHAN TANJUNG PRIOK,Jakarta Utara", "Gudang  Cakung,\nBlok C7", " "
	tests := []struct {
		name string
		it   PurchaseOrderItem
		want string
	}{
		{"no destination", dnLine("A", "1", nil, nil), ""},
		{"blank destination", dnLine("A", "1", nil, &blank), ""},
		{"the header destination", dnLine("A", "1", nil, &priok), ""},
		{"the header destination typed another way", dnLine("A", "1", nil, &priokTyped), ""},
		{"another destination", dnLine("A", "1", nil, &cakung), "Kirim ke: Gudang Cakung, Blok C7"},
		{"the shipping line", shippingTo(&cakung), ""},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := defaultNote(tc.it, priok); got != tc.want {
				t.Errorf("defaultNote = %q, want %q", got, tc.want)
			}
		})
	}
}

// Goods only, without gaps (PO-12).
// The shipping charge is billed on the invoice but is not something the
// driver hands over, so it must not print as a delivered line. A row prints
// its stored note, or its default until one is saved.
func TestDeliveryNoteItems(t *testing.T) {
	pcs, box := "PCS", "BOX"
	priok, hold := "Pelabuhan Tanjung Priok", "Gudang 50%"
	longPart := "GNS" + strings.Repeat("7X4Q", 14) + "Z"
	longNote := "Simpan" + strings.Repeat("DIGUDANGDINGIN", 4)
	shipping := shippingTo(&priok)

	tests := []struct {
		name  string
		items []PurchaseOrderItem
		want  []dnItem
	}{
		{"no lines", nil, []dnItem{}},
		{
			"goods keep their order and escape LaTeX",
			[]PurchaseOrderItem{
				withNote(dnLine("Tali_Tambang", "2.50", &pcs, nil), "Deck & Hold #2"),
				dnLine("Cat #1", "10.00", &box, nil),
			},
			[]dnItem{
				{No: 1, Qty: "2.5", Unit: "PCS", Name: `Tali\_Tambang`, Note: `Deck~\&~Hold~\#2`},
				{No: 2, Qty: "10", Unit: "BOX", Name: `Cat \#1`},
			},
		},
		{
			"a row at the header destination has no note",
			[]PurchaseOrderItem{dnLine("Lampu", "3", &pcs, &priok), shipping},
			[]dnItem{{No: 1, Qty: "3", Unit: "PCS", Name: "Lampu"}},
		},
		{
			"a row going elsewhere starts with where",
			[]PurchaseOrderItem{dnLine("Lampu", "3", &pcs, &hold), shipping},
			[]dnItem{{No: 1, Qty: "3", Unit: "PCS", Name: "Lampu", Note: `Kirim~ke:~Gudang~50\%`}},
		},
		{
			"a saved note replaces the default",
			[]PurchaseOrderItem{withNote(dnLine("Lampu", "3", &pcs, &hold), "Serahkan ke mualim"), shipping},
			[]dnItem{{No: 1, Qty: "3", Unit: "PCS", Name: "Lampu", Note: "Serahkan~ke~mualim"}},
		},
		{
			"a cleared note stays blank",
			[]PurchaseOrderItem{withNote(dnLine("Lampu", "3", &pcs, &hold), ""), shipping},
			[]dnItem{{No: 1, Qty: "3", Unit: "PCS", Name: "Lampu"}},
		},
		{
			"missing unit prints blank",
			[]PurchaseOrderItem{dnLine("Lampu", "3", nil, nil)},
			[]dnItem{{No: 1, Qty: "3", Unit: "", Name: "Lampu"}},
		},
		{
			"numbering skips the shipping charge",
			[]PurchaseOrderItem{dnLine("A", "1", &pcs, nil), shipping, dnLine("B", "2", &pcs, nil)},
			[]dnItem{
				{No: 1, Qty: "1", Unit: "PCS", Name: "A"},
				{No: 2, Qty: "2", Unit: "PCS", Name: "B"},
			},
		},
		{
			"a long part number gets break points",
			[]PurchaseOrderItem{dnLine(longPart, "1", &pcs, nil)},
			[]dnItem{{No: 1, Qty: "1", Unit: "PCS", Name: pdfgen.LatexBreakable(longPart)}},
		},
		{
			"a long note gets break points",
			[]PurchaseOrderItem{withNote(dnLine("A", "1", &pcs, nil), longNote)},
			[]dnItem{{No: 1, Qty: "1", Unit: "PCS", Name: "A", Note: pdfgen.LatexBreakable(longNote)}},
		},
		{"only a shipping charge", []PurchaseOrderItem{shipping}, []dnItem{}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := deliveryNoteItems(tc.items, priok); !reflect.DeepEqual(got, tc.want) {
				t.Errorf("deliveryNoteItems =\n%#v\nwant\n%#v", got, tc.want)
			}
		})
	}
}

// Defaults ride on the items read.
// Product lines only; the shipping line and stored notes are left as read.
func TestWithNoteDefaults(t *testing.T) {
	priok, hold := "Pelabuhan Tanjung Priok", "Gudang Cakung"
	items := []PurchaseOrderItem{
		dnLine("A", "1", nil, &priok),
		withNote(dnLine("B", "1", nil, &hold), "Sudah dicatat"),
		shippingTo(&priok),
	}
	withNoteDefaults(items, priok)
	got := []string{items[0].DnNoteDefault, items[1].DnNoteDefault, items[2].DnNoteDefault}
	want := []string{"", "Kirim ke: Gudang Cakung", ""}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("defaults = %q, want %q", got, want)
	}
	if *items[1].DnNote != "Sudah dicatat" {
		t.Errorf("stored note changed to %q", *items[1].DnNote)
	}
}
