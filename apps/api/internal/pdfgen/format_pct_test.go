package pdfgen

import "testing"

// Percent as Indonesians write it.
// A comma for the decimals and none that add nothing: "5", never "5.00".
func TestFormatPct(t *testing.T) {
	cases := []struct{ in, want string }{
		{"5.00", "5"},
		{"5", "5"},
		{"2.50", "2,5"},
		{"12.25", "12,25"},
		{"0.75", "0,75"},
		{"100.00", "100"},
		{"0", "0"},
		{"33.333", "33,33"},
		{"", ""},
		{"abc", ""},
	}
	for _, c := range cases {
		if got := FormatPct(c.in); got != c.want {
			t.Errorf("FormatPct(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

// Zero amounts print no row.
func TestIsZero(t *testing.T) {
	cases := []struct {
		in   string
		want bool
	}{
		{"0", true}, {"0.00", true}, {"", true}, {"abc", true},
		{"0.01", false}, {"888000.00", false}, {"-1", false},
	}
	for _, c := range cases {
		if got := IsZero(c.in); got != c.want {
			t.Errorf("IsZero(%q) = %v, want %v", c.in, got, c.want)
		}
	}
}
