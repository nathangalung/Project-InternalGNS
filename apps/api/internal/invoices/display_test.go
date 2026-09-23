package invoices

import "testing"

// Documents must describe what is actually supplied. The snapshot carries the
// customer's request text, so the offered catalog item wins when there is one.
func TestInvoiceItem_Display(t *testing.T) {
	t.Parallel()
	ptr := func(s string) *string { return &s }
	cases := []struct {
		name     string
		item     InvoiceItem
		wantName string
		wantCode string
	}{
		{
			name:     "offered item wins",
			item:     InvoiceItem{ItemName: "valve 2 inch pls check", ItemCode: ptr("REQ-1"), OfferedItemName: ptr("BALL VALVE 2IN SS316"), OfferedItemCode: ptr("751201")},
			wantName: "BALL VALVE 2IN SS316",
			wantCode: "751201",
		},
		{
			name:     "free-text line keeps the request",
			item:     InvoiceItem{ItemName: "valve 2 inch pls check", ItemCode: ptr("REQ-1")},
			wantName: "valve 2 inch pls check",
			wantCode: "REQ-1",
		},
		{
			name:     "offered item without a code keeps the snapshot code",
			item:     InvoiceItem{ItemName: "req", ItemCode: ptr("REQ-1"), OfferedItemName: ptr("LAMP LED 12W")},
			wantName: "LAMP LED 12W",
			wantCode: "REQ-1",
		},
		{
			name:     "blank offered name falls back",
			item:     InvoiceItem{ItemName: "req", OfferedItemName: ptr("  ")},
			wantName: "req",
			wantCode: "",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if got := tc.item.DisplayName(); got != tc.wantName {
				t.Errorf("DisplayName() = %q, want %q", got, tc.wantName)
			}
			if got := tc.item.DisplayCode(); got != tc.wantCode {
				t.Errorf("DisplayCode() = %q, want %q", got, tc.wantCode)
			}
		})
	}
}

// The tax invoice must name the goods actually supplied.
func TestBuildGoodService_PrintsOfferedItem(t *testing.T) {
	t.Parallel()
	ptr := func(s string) *string { return &s }
	gs := buildGoodService(InvoiceItem{
		ItemName:        "valve 2 inch pls check",
		ItemCode:        ptr("REQ-1"),
		OfferedItemName: ptr("BALL VALVE 2IN SS316"),
		OfferedItemCode: ptr("751201"),
		Qty:             "1",
		UnitPrice:       "100000",
	})
	if gs.Name != "BALL VALVE 2IN SS316" {
		t.Errorf("Name = %q, want the offered item", gs.Name)
	}
	if gs.Code != "751201" {
		t.Errorf("Code = %q, want the offered code", gs.Code)
	}
}
