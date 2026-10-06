package pdfgen

import "testing"

// Rupiah as the app prints it.
// "Rp2.000.000" with no space and no ",00", like the web's formatRupiah;
// a figure with real sen, such as a PPN, keeps both digits.
func TestFormatIDRCents(t *testing.T) {
	cases := []struct{ in, want string }{
		{"", "-"},
		{"0", "Rp0"},
		{"1001.00", "Rp1.001"},
		{"2000000", "Rp2.000.000"},
		{"75.50", "Rp75,50"},
		{"925.5", "Rp925,50"},
		{"2802750.25", "Rp2.802.750,25"},
		{"-200.10", "-Rp200,10"},
		{"-1284000.00", "-Rp1.284.000"},
		{"abc", "-"},
	}
	for _, c := range cases {
		if got := FormatIDRCents(c.in); got != c.want {
			t.Errorf("FormatIDRCents(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

// Printed column reconciles.
// total - discount = subtotal, sen shown wherever a figure has them.
func TestFormatIDRCents_ColumnReconciles(t *testing.T) {
	cases := map[string]string{"1001.00": "Rp1.001", "75.50": "Rp75,50", "925.50": "Rp925,50"}
	for in, want := range cases {
		if got := FormatIDRCents(in); got != want {
			t.Errorf("FormatIDRCents(%q) = %q, want %q", in, got, want)
		}
	}
}
