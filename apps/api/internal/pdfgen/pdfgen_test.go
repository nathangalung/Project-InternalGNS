package pdfgen

import "testing"

func TestLatexEscape(t *testing.T) {
	cases := map[string]string{
		"a & b": `a \& b`,
		"100%":  `100\%`,
		"x_y":   `x\_y`,
		"#1":    `\#1`,
		"a$b":   `a\$b`,
		"{x}":   `\{x\}`,
		"a~b":   `a\textasciitilde{}b`,
		"a^b":   `a\textasciicircum{}b`,
		"<x>":   `\textless{}x\textgreater{}`,
		"a|b":   `a\textbar{}b`,
		`a\b`:   `a\textbackslash{}b`,
		"safe":  "safe",
	}
	for in, want := range cases {
		if got := LatexEscape(in); got != want {
			t.Errorf("LatexEscape(%q) = %q; want %q", in, got, want)
		}
	}
}

func TestFormatQty(t *testing.T) {
	cases := map[string]string{
		"":         "0",
		"0":        "0",
		"5":        "5",
		"5.00":     "5",
		"1.500":    "1.5",
		"10.10":    "10.1",
		"-3.0":     "-3",
		"  7.50  ": "7.5",
	}
	for in, want := range cases {
		if got := FormatQty(in); got != want {
			t.Errorf("FormatQty(%q) = %q; want %q", in, got, want)
		}
	}
}

func TestFormatIDR(t *testing.T) {
	cases := map[string]string{
		"":             "Rp~--",
		"0":            "Rp~0",
		"100":          "Rp~100",
		"1000":         "Rp~1.000",
		"123456789":    "Rp~123.456.789",
		"123456789.50": "Rp~123.456.789",
		"-6316150":     "-Rp~6.316.150",
		"abc":          "Rp~--",
	}
	for in, want := range cases {
		if got := FormatIDR(in); got != want {
			t.Errorf("FormatIDR(%q) = %q; want %q", in, got, want)
		}
	}
}
