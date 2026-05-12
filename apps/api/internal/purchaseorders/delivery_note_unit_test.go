package purchaseorders

import "testing"

func TestPoStrDeref(t *testing.T) {
	if got := strDeref(nil); got != "" {
		t.Errorf("nil: %q", got)
	}
	s := "x"
	if got := strDeref(&s); got != "x" {
		t.Errorf("got %q", got)
	}
}

func TestPoSanitizeFilename(t *testing.T) {
	cases := []struct{ in, want string }{
		{"DN-001", "DN-001"},
		{"a b", "a_b"},
		{"", "document"},
		{"@#$", "___"},
		{"x.pdf", "x.pdf"},
	}
	for _, c := range cases {
		if got := sanitizeFilename(c.in); got != c.want {
			t.Errorf("sanitize(%q)=%q want %q", c.in, got, c.want)
		}
	}
}
