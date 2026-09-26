package purchaseorders

import (
	"reflect"
	"testing"
)

// Goods only, without gaps (PO-12).
// The shipping charge is billed on the invoice but is not something the
// driver hands over, so it must not print as a delivered line. Its address
// is the Tujuan of any line without its own.
func TestDeliveryNoteItems(t *testing.T) {
	pcs, box := "PCS", "BOX"
	deck, hold, blank := "Deck & Hold #2", "Gudang 50%", "  "
	product := func(name, qty string, unit, ship *string) PurchaseOrderItem {
		return PurchaseOrderItem{ItemType: "product", ItemName: name, Qty: qty, UnitCode: unit, ShipDestination: ship}
	}
	shipping := PurchaseOrderItem{ItemType: "shipping", ItemName: "Pengiriman", Qty: "1.00", ShipDestination: &deck}

	tests := []struct {
		name  string
		items []PurchaseOrderItem
		want  []dnItem
	}{
		{"no lines", nil, []dnItem{}},
		{
			"goods keep their order and escape LaTeX",
			[]PurchaseOrderItem{
				product("Tali_Tambang", "2.50", &pcs, &deck),
				product("Cat #1", "10.00", &box, &hold),
			},
			[]dnItem{
				{No: 1, Qty: "2.5", Unit: "PCS", Name: `Tali\_Tambang`, ShipDestination: `Deck \& Hold \#2`},
				{No: 2, Qty: "10", Unit: "BOX", Name: `Cat \#1`, ShipDestination: `Gudang 50\%`},
			},
		},
		{
			"missing unit and destination print blank",
			[]PurchaseOrderItem{product("Lampu", "3", nil, nil)},
			[]dnItem{{No: 1, Qty: "3", Unit: "", Name: "Lampu", ShipDestination: ""}},
		},
		{
			"the shipping charge is left out",
			[]PurchaseOrderItem{product("Lampu", "3", &pcs, &hold), shipping},
			[]dnItem{{No: 1, Qty: "3", Unit: "PCS", Name: "Lampu", ShipDestination: `Gudang 50\%`}},
		},
		{
			"numbering skips the shipping charge",
			[]PurchaseOrderItem{product("A", "1", &pcs, &hold), shipping, product("B", "2", &pcs, &hold)},
			[]dnItem{
				{No: 1, Qty: "1", Unit: "PCS", Name: "A", ShipDestination: `Gudang 50\%`},
				{No: 2, Qty: "2", Unit: "PCS", Name: "B", ShipDestination: `Gudang 50\%`},
			},
		},
		{
			"unaddressed goods take the shipping line address",
			[]PurchaseOrderItem{product("A", "1", &pcs, nil), product("B", "2", &pcs, &blank), shipping},
			[]dnItem{
				{No: 1, Qty: "1", Unit: "PCS", Name: "A", ShipDestination: `Deck \& Hold \#2`},
				{No: 2, Qty: "2", Unit: "PCS", Name: "B", ShipDestination: `Deck \& Hold \#2`},
			},
		},
		{
			"addressed goods keep their own",
			[]PurchaseOrderItem{product("A", "1", &pcs, &hold), product("B", "2", &pcs, nil), shipping},
			[]dnItem{
				{No: 1, Qty: "1", Unit: "PCS", Name: "A", ShipDestination: `Gudang 50\%`},
				{No: 2, Qty: "2", Unit: "PCS", Name: "B", ShipDestination: `Deck \& Hold \#2`},
			},
		},
		{
			"a blank shipping address leaves goods blank",
			[]PurchaseOrderItem{product("A", "1", &pcs, nil), {ItemType: "shipping", ItemName: "Pengiriman", Qty: "1.00", ShipDestination: &blank}},
			[]dnItem{{No: 1, Qty: "1", Unit: "PCS", Name: "A"}},
		},
		{"only a shipping charge", []PurchaseOrderItem{shipping}, []dnItem{}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := deliveryNoteItems(tc.items); !reflect.DeepEqual(got, tc.want) {
				t.Errorf("deliveryNoteItems =\n%#v\nwant\n%#v", got, tc.want)
			}
		})
	}
}
