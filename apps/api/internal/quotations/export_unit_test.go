package quotations

import "testing"

func TestExportStrDeref(t *testing.T) {
	if got := strDeref(nil); got != "" {
		t.Errorf("nil: %q", got)
	}
	v := "abc"
	if got := strDeref(&v); got != "abc" {
		t.Errorf("got %q", got)
	}
}

func TestExportZero(t *testing.T) {
	if zero("") != "0" {
		t.Error("empty")
	}
	if zero("5") != "5" {
		t.Error("nonempty")
	}
}

func TestBigSub(t *testing.T) {
	cases := []struct{ a, b, want string }{
		{"100", "30", "70.00"},
		{"", "10", "-10.00"},
		{"10", "", "10.00"},
		{"bad", "5", "-5.00"},
		{"5", "bad", "5.00"},
	}
	for _, c := range cases {
		if got := bigSub(c.a, c.b); got != c.want {
			t.Errorf("bigSub(%q,%q)=%q want %q", c.a, c.b, got, c.want)
		}
	}
}

func TestBigMul(t *testing.T) {
	cases := []struct{ a, b, want string }{
		{"2", "3", "6.00"},
		{"", "5", "0.00"},
		{"2", "", "0.00"},
		{"bad", "1", "0.00"},
		{"1", "bad", "0.00"},
		{"2.5", "4", "10.00"},
	}
	for _, c := range cases {
		if got := bigMul(c.a, c.b); got != c.want {
			t.Errorf("bigMul(%q,%q)=%q want %q", c.a, c.b, got, c.want)
		}
	}
}

func TestBigMulDiv(t *testing.T) {
	cases := []struct{ a, num, den, want string }{
		{"120", "11", "12", "110.00"},
		{"0", "11", "12", "0.00"},
		{"100", "1", "0", "0"},
		{"100", "1", "", "0"},
		{"abc", "1", "1", "0.00"},
	}
	for _, c := range cases {
		if got := bigMulDiv(c.a, c.num, c.den); got != c.want {
			t.Errorf("bigMulDiv(%q,%q,%q)=%q want %q", c.a, c.num, c.den, got, c.want)
		}
	}
}

func TestExportSanitizeFilename(t *testing.T) {
	cases := []struct{ in, want string }{
		{"Q-001", "Q-001"},
		{"a/b", "a_b"},
		{"", "document"},
		{"!@#", "___"},
		{"foo.pdf", "foo.pdf"},
	}
	for _, c := range cases {
		if got := sanitizeFilename(c.in); got != c.want {
			t.Errorf("sanitize(%q)=%q want %q", c.in, got, c.want)
		}
	}
}
