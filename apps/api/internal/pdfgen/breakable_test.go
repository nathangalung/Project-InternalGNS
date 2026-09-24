package pdfgen

import (
	"strings"
	"testing"
)

// Long tokens get break points; short text is plain escaping.
func TestLatexBreakable(t *testing.T) {
	const br = `\discretionary{}{}{}`
	long := strings.Repeat("A", breakRun+1)
	cases := []struct {
		name, in, want string
	}{
		{"empty", "", ""},
		{"short words", "Fire hose & coupling", `Fire hose \& coupling`},
		{"token at the limit", strings.Repeat("B", breakRun), strings.Repeat("B", breakRun)},
		{"token over the limit", long, strings.Join(strings.Split(long, ""), br)},
		{"escapes stay whole", "A_B%" + strings.Repeat("C", breakRun),
			`A` + br + `\_` + br + `B` + br + `\%` + br + strings.Join(strings.Split(strings.Repeat("C", breakRun), ""), br)},
		{"spacing kept", "x  " + long + " y", "x  " + strings.Join(strings.Split(long, ""), br) + " y"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := LatexBreakable(c.in); got != c.want {
				t.Errorf("LatexBreakable(%q) = %q, want %q", c.in, got, c.want)
			}
		})
	}
}

// Q-16: a long part number wraps inside its cell.
func TestLatexExports_LongTokenWraps(t *testing.T) {
	long := "SUPERLONGUNBROKENPARTNUMBERWITHOUTANYSPACESXYZ1234567890ABCDEFGH"
	for _, a4 := range []bool{false, true} {
		items := sampleItems(2)
		// Priced rows only: an A4 No Offer row is underfull on its own.
		items[1]["HasOffer"] = true
		items[0]["Request"] = LatexBreakable(long)
		items[0]["Offer"] = LatexBreakable(long + " (" + long + ")")
		d := quotationData(items)
		d["UseA4"] = a4
		log := compileLog(t, "quotation/Quotation.tex.tmpl", d)
		if !producedOutput(log) {
			t.Skip("xelatex produced no output")
		}
		if over, under, warn := badBoxes(log); over != 0 || under != 0 || warn != 0 {
			t.Errorf("A4=%v: overfull=%d underfull=%d warnings=%d, want all 0", a4, over, under, warn)
		}
	}
}
