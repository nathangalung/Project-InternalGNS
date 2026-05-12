package pdfgen

import (
	"net/http/httptest"
	"testing"
)

func TestStrDeref(t *testing.T) {
	if got := StrDeref(nil); got != "" {
		t.Errorf("nil: got %q", got)
	}
	s := "abc"
	if got := StrDeref(&s); got != "abc" {
		t.Errorf("got %q", got)
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
		{"DN-2024-001", "DN-2024-001"},
	}
	for _, c := range cases {
		if got := SanitizeFilename(c.in); got != c.want {
			t.Errorf("SanitizeFilename(%q)=%q want %q", c.in, got, c.want)
		}
	}
}

func TestZero(t *testing.T) {
	if zero("") != "0" {
		t.Error("empty -> 0")
	}
	if zero("12") != "12" {
		t.Error("nonempty passthrough")
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
		if got := BigMul(c.a, c.b); got != c.want {
			t.Errorf("BigMul(%q,%q)=%q want %q", c.a, c.b, got, c.want)
		}
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
		if got := BigSub(c.a, c.b); got != c.want {
			t.Errorf("BigSub(%q,%q)=%q want %q", c.a, c.b, got, c.want)
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
		if got := BigMulDiv(c.a, c.num, c.den); got != c.want {
			t.Errorf("BigMulDiv(%q,%q,%q)=%q want %q", c.a, c.num, c.den, got, c.want)
		}
	}
}

func TestWritePDFResponse(t *testing.T) {
	w := httptest.NewRecorder()
	body := []byte("%PDF-payload%")
	if err := WritePDFResponse(w, "INV-001 / draft", body); err != nil {
		t.Fatalf("WritePDFResponse: %v", err)
	}
	if got := w.Header().Get("Content-Type"); got != "application/pdf" {
		t.Errorf("Content-Type=%q", got)
	}
	const wantCD = `attachment; filename="INV-001___draft.pdf"`
	if got := w.Header().Get("Content-Disposition"); got != wantCD {
		t.Errorf("Content-Disposition=%q want %q", got, wantCD)
	}
	if got := w.Body.String(); got != string(body) {
		t.Errorf("body=%q want %q", got, string(body))
	}
}
