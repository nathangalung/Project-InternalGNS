package pdfgen

import "testing"

// Cents survive the quotation formatter.
func TestFormatIDRCents(t *testing.T) {
	cases := []struct{ in, want string }{
		{"", "Rp~--"},
		{"0", "Rp~0,00"},
		{"1001.00", "Rp~1.001,00"},
		{"75.50", "Rp~75,50"},
		{"925.50", "Rp~925,50"},
		{"2802750.25", "Rp~2.802.750,25"},
		{"-200.10", "-Rp~200,10"},
		{"1788.5", "Rp~1.788,50"},
		{"abc", "Rp~--"},
	}
	for _, c := range cases {
		if got := FormatIDRCents(c.in); got != c.want {
			t.Errorf("FormatIDRCents(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

// Printed column reconciles.
// total - discount = subtotal.
func TestFormatIDRCents_ColumnReconciles(t *testing.T) {
	total, discount, subtotal := "1001.00", "75.50", "925.50"
	if FormatIDRCents(total) == FormatIDR(total) {
		t.Fatal("the quotation formatter must differ from the truncating one")
	}
	if got, want := FormatIDRCents(subtotal), "Rp~925,50"; got != want {
		t.Errorf("subtotal = %q, want %q", got, want)
	}
	if FormatIDR(discount) != "Rp~75" {
		t.Errorf("FormatIDR must keep truncating for invoices, got %q", FormatIDR(discount))
	}
}
