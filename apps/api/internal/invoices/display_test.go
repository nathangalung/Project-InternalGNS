package invoices

import "testing"

// Coretax files the stored line snapshot.
func TestBuildGoodService_PrintsSnapshot(t *testing.T) {
	t.Parallel()
	ptr := func(s string) *string { return &s }
	cases := []struct {
		name     string
		item     InvoiceItem
		wantName string
		wantCode string
	}{
		{
			name:     "snapshot name and code",
			item:     InvoiceItem{ItemName: "BALL VALVE 2IN SS316", ItemCode: ptr("751201")},
			wantName: "BALL VALVE 2IN SS316",
			wantCode: "751201",
		},
		{
			name:     "snapshot without a code",
			item:     InvoiceItem{ItemName: "valve 2 inch pls check"},
			wantName: "valve 2 inch pls check",
			wantCode: "",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			tc.item.Qty = "1"
			tc.item.UnitPrice = "100000"
			gs := buildGoodService(tc.item)
			if gs.Name != tc.wantName {
				t.Errorf("Name = %q, want %q", gs.Name, tc.wantName)
			}
			if gs.Code != tc.wantCode {
				t.Errorf("Code = %q, want %q", gs.Code, tc.wantCode)
			}
		})
	}
}
