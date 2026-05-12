package invoices

import "testing"

func TestStrDeref(t *testing.T) {
	if got := strDeref(nil); got != "" {
		t.Errorf("nil: got %q", got)
	}
	s := "abc"
	if got := strDeref(&s); got != "abc" {
		t.Errorf("got %q", got)
	}
}

func TestZero(t *testing.T) {
	if got := zero(""); got != "0" {
		t.Errorf("empty: %q", got)
	}
	if got := zero("12"); got != "12" {
		t.Errorf("nonempty: %q", got)
	}
}

func TestMulNumStr(t *testing.T) {
	cases := []struct {
		a, b, want string
	}{
		{"2", "3", "6.00"},
		{"", "5", "0.00"},
		{"2.5", "4", "10.00"},
		{"abc", "1", "0"},
		{"1", "xyz", "0"},
	}
	for _, c := range cases {
		if got := mulNumStr(c.a, c.b); got != c.want {
			t.Errorf("mulNumStr(%q,%q)=%q want %q", c.a, c.b, got, c.want)
		}
	}
}

func TestSanitizeFilename(t *testing.T) {
	cases := []struct{ in, want string }{
		{"INV-001", "INV-001"},
		{"foo/bar", "foo_bar"},
		{"a b c", "a_b_c"},
		{"", "document"},
		{"!@#", "___"},
		{"abc_123.pdf", "abc_123.pdf"},
	}
	for _, c := range cases {
		if got := sanitizeFilename(c.in); got != c.want {
			t.Errorf("sanitize(%q)=%q want %q", c.in, got, c.want)
		}
	}
}
