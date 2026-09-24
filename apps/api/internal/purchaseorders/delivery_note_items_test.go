package purchaseorders

import (
	"reflect"
	"testing"
)

// Goods only, without gaps (PO-12).
// The shipping charge is billed on the invoice but is not something the
// driver hands over, so it must not print as a delivered line.
func TestDeliveryNoteItems(t *testing.T) {
	pcs, box := "PCS", "BOX"
	deck, hold := "Deck & Hold #2", "Gudang 50%"
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
			[]PurchaseOrderItem{product("Lampu", "3", &pcs, nil), shipping},
			[]dnItem{{No: 1, Qty: "3", Unit: "PCS", Name: "Lampu", ShipDestination: ""}},
		},
		{
			"numbering skips the shipping charge",
			[]PurchaseOrderItem{product("A", "1", &pcs, nil), shipping, product("B", "2", &pcs, nil)},
			[]dnItem{
				{No: 1, Qty: "1", Unit: "PCS", Name: "A"},
				{No: 2, Qty: "2", Unit: "PCS", Name: "B"},
			},
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
