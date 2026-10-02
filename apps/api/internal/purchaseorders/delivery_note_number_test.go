package purchaseorders

import (
	"testing"
	"time"
)

// Note prints its stored number.
// It prints only once work started.
func TestIssuedDeliveryNote(t *testing.T) {
	num := "DN-26264141/GNS/IX/2026"
	empty := ""
	cases := []struct {
		name   string
		status Status
		dn     *string
		want   string
		wantOK bool
	}{
		{"pending has none", StatusPending, nil, "", false},
		{"uploaded has none", StatusUploaded, nil, "", false},
		{"reverted keeps number but cannot print", StatusUploaded, &num, "", false},
		{"on progress prints stored", StatusOnProgress, &num, num, true},
		{"delivered prints stored", StatusDelivered, &num, num, true},
		{"on progress without number refused", StatusOnProgress, nil, "", false},
		{"blank number refused", StatusDelivered, &empty, "", false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, ok := issuedDeliveryNote(PurchaseOrder{Status: c.status, DeliveryNoteNumber: c.dn})
			if got != c.want || ok != c.wantOK {
				t.Errorf("issuedDeliveryNote = (%q, %v), want (%q, %v)", got, ok, c.want, c.wantOK)
			}
		})
	}
}

// Note dated when issued.
// A legacy PO with no stamp falls back to its PO date.
func TestDeliveryNoteDate(t *testing.T) {
	poDate := time.Date(2025, 12, 28, 0, 0, 0, 0, time.UTC)
	issued := time.Date(2026, 1, 5, 0, 0, 0, 0, time.UTC)
	cases := []struct {
		name string
		po   PurchaseOrder
		want time.Time
	}{
		{"stamped prints its own date", PurchaseOrder{PoDate: poDate, DeliveryNoteDate: &issued}, issued},
		{"legacy falls back to the PO date", PurchaseOrder{PoDate: poDate}, poDate},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := deliveryNoteDate(c.po); !got.Equal(c.want) {
				t.Errorf("deliveryNoteDate = %v, want %v", got, c.want)
			}
		})
	}
}
