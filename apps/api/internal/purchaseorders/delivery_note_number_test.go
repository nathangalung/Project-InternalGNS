package purchaseorders

import "testing"

// DN number mirrors the quotation number with a DN- prefix.
func TestDeliveryNoteNumber(t *testing.T) {
	cases := []struct {
		name, qno, pono, want string
	}{
		{"from quotation", "Q-2640034/GNS/I/2026", "JKT-PO/031.034/A01/0226", "DN-2640034/GNS/I/2026"},
		{"december core", "Q-25400537/GNS/XII/2025", "V-26-2405-005-E/02/01", "DN-25400537/GNS/XII/2025"},
		{"fallback to po number", "", "JKT-PO/zzz", "DN-JKT-PO/zzz"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := deliveryNoteNumber(c.qno, c.pono); got != c.want {
				t.Errorf("deliveryNoteNumber(%q, %q) = %q, want %q", c.qno, c.pono, got, c.want)
			}
		})
	}
}
