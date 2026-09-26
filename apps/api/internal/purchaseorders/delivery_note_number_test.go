package purchaseorders

import "testing"

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
