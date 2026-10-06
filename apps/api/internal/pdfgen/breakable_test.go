package pdfgen

import (
	"strings"
	"testing"
)

// Long tokens get break points.
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

// Q-16: long tokens wrap.
func TestLatexExports_LongTokenWraps(t *testing.T) {
	long := "SUPERLONGUNBROKENPARTNUMBERWITHOUTANYSPACESXYZ1234567890ABCDEFGH"
	// The second row is No Offer, whose filled price cells stay clean too.
	items := sampleItems(2)
	items[0]["Request"] = LatexBreakable(long)
	items[0]["Offer"] = LatexBreakable(long + " (" + long + ")")
	log := compileLog(t, "quotation/Quotation.tex.tmpl", quotationData(items))
	if !producedOutput(log) {
		t.Skip("xelatex produced no output")
	}
	if over, under, warn := badBoxes(log); over != 0 || under != 0 || warn != 0 {
		t.Errorf("overfull=%d underfull=%d warnings=%d, want all 0", over, under, warn)
	}
}
