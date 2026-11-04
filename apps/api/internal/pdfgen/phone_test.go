package pdfgen

import "testing"

// Phones print with the country code.
// A contact keeps its local number and its country, so the printed number
// is the dial code, then the number without its trunk 0. A number typed
// with its own + stays as typed, and a country with no dial code prints
// the number alone.
func TestInternationalPhone(t *testing.T) {
	cases := []struct {
		name, dial, phone, want string
	}{
		{"local mobile", "+62", "081211112222", "+62 81211112222"},
		{"stored without trunk 0", "+62", "81211112222", "+62 81211112222"},
		{"separators kept", "+62", "0812-1111-2222", "+62 812-1111-2222"},
		{"surrounding space", "+62", "  0812 1111 2222 ", "+62 812 1111 2222"},
		{"already international", "+62", "+65 6123 4567", "+65 6123 4567"},
		{"other country", "+65", "61234567", "+65 61234567"},
		{"no dial code", "", "0812 1111 2222", "0812 1111 2222"},
		{"no phone", "+62", "  ", ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := InternationalPhone(c.dial, c.phone); got != c.want {
				t.Errorf("InternationalPhone(%q, %q) = %q, want %q", c.dial, c.phone, got, c.want)
			}
		})
	}
}
