package pdfgen

import (
	"image"
	"math"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

// Page geometry in points.
const (
	cm          = 72 / 2.54
	paperW      = 595.28
	paperH      = 841.89
	margin      = 0.75 * cm
	logoWidthPt = 4.45 * cm
	// inkTol allows for the 144 dpi raster.
	inkTol = 1.5
)

// logoWidth reads the first image.
// pdfimages gives the pixel size and the ppi it was placed at, so the
// printed width is pixels over ppi.
func logoWidth(t *testing.T, pdf string) float64 {
	t.Helper()
	bin, err := exec.LookPath("pdfimages")
	if err != nil {
		t.Skip("pdfimages unavailable")
	}
	out, err := exec.Command(bin, "-list", "-f", "1", "-l", "1", pdf).Output()
	if err != nil {
		t.Fatalf("pdfimages: %v", err)
	}
	for _, ln := range strings.Split(string(out), "\n") {
		f := strings.Fields(ln)
		if len(f) < 13 || f[2] != "image" {
			continue
		}
		px, _ := strconv.ParseFloat(f[3], 64)
		ppi, _ := strconv.ParseFloat(f[12], 64)
		if ppi > 0 {
			return px / ppi * 72
		}
	}
	t.Fatal("no image on page 1")
	return 0
}

// near compares within a tolerance.
func near(got, want, tol float64) bool {
	return math.Abs(got-want) <= tol
}

// longDocs run past one page.
var longDocs = []struct {
	name, tmpl, title, number string
	data                      map[string]any
}{
	{"quotation", "quotation/Quotation.tex.tmpl", "QUOTATION", "Q-26400393/GNS/IV/2026", quotationData(sampleItems(60))},
	{"invoice", "invoice/Invoice.tex.tmpl", "INVOICE", "INV-26400393/GNS/IV/2026", invoiceData(sampleItems(60))},
	{"delivery note", "delivery_note/DeliveryNote.tex.tmpl", "DELIVERY", "DN-26778001/GNS/IV/2026", deliveryNoteData(sampleItems(60))},
}

// Margins and head sizes hold.
// Every page keeps the same 0.75 cm between its printed marks and all four
// paper edges: the letterhead on page 1 and the running header after it at
// the top, the page count at the bottom, the letterhead and table rules at
// the sides. The logo is 4.45 cm wide and the number is set smaller than
// the title above it.
func TestLatexExports_Margins(t *testing.T) {
	for _, d := range longDocs {
		t.Run(d.name, func(t *testing.T) {
			log, dir := compileDir(t, d.tmpl, d.data)
			if !producedOutput(log) {
				t.Skip("xelatex produced no output")
			}
			pages := pageCount(log)
			if pages < 2 {
				t.Fatalf("pages = %d, want a running header on page 2", pages)
			}
			pdf := filepath.Join(dir, "doc.pdf")

			for p := 1; p <= pages; p++ {
				top, bottom, left, right := inkBox(renderPage(t, pdf, p))
				for _, e := range []struct {
					edge      string
					got, want float64
				}{
					{"top", top, margin},
					{"bottom", paperH - bottom, margin},
					{"left", left, margin},
					{"right", paperW - right, margin},
				} {
					if !near(e.got, e.want, inkTol) {
						t.Errorf("page %d: %s margin %.1f pt, want %.1f", p, e.edge, e.got, e.want)
					}
				}
			}

			// Page 1 opens with the letterhead. Its logo holds the top margin.
			words := firstPageWords(t, pdf)
			first := words[0]
			for _, w := range words {
				if w.yMin < first.yMin {
					first = w
				}
			}
			if first.text != "Gedung" && first.text != "Telp." {
				t.Errorf("page 1 opens with %q, want the letterhead", first.text)
			}

			// Logo: its visible mark keeps 4.45 cm.
			if w := logoWidth(t, pdf); !near(w, logoWidthPt, 1.5) {
				t.Errorf("logo %.1f pt wide, want %.1f", w, logoWidthPt)
			}

			// Number: smaller than the title, which keeps its size.
			title, ok := topmost(words, d.title)
			if !ok {
				t.Fatalf("title %q not on page 1", d.title)
			}
			number, ok := topmost(words, d.number)
			if !ok {
				t.Fatalf("number %q not on page 1", d.number)
			}
			th, nh := title.yMax-title.yMin, number.yMax-number.yMin
			if ratio := nh / th; ratio > 0.8 {
				t.Errorf("number %.1f pt tall, title %.1f pt, ratio %.3f, want at most 0.8", nh, th, ratio)
			}
			// Box heights scale with size: \Large is 14.4 pt, the count 8 pt.
			of, ok := lowest(words, "of")
			if !ok {
				t.Fatal("page count not on page 1")
			}
			if ratio := th / (of.yMax - of.yMin); !near(ratio, 14.4/8, 0.05) {
				t.Errorf("title to page count height ratio %.3f, want %.3f", ratio, 14.4/8)
			}
			// Table cells: 7.5 pt, a little under the count.
			qty, ok := topmost(words, "Qty")
			if !ok {
				t.Fatal("table header not on page 1")
			}
			if ratio := (qty.yMax - qty.yMin) / (of.yMax - of.yMin); !near(ratio, 7.5/8, 0.02) {
				t.Errorf("table cell to page count height ratio %.3f, want %.3f", ratio, 7.5/8)
			}
		})
	}
}

// Running header clears the content.
// From page 2 on the header is the first line, at the top margin, and ends
// well above the table it heads. Every page ends with its count, the lowest
// line, kept inside the bottom margin so a printer does not cut it.
func TestLatexExports_RunningHeader(t *testing.T) {
	for _, d := range longDocs {
		t.Run(d.name, func(t *testing.T) {
			log, dir := compileDir(t, d.tmpl, d.data)
			if !producedOutput(log) {
				t.Skip("xelatex produced no output")
			}
			pages := pageCount(log)
			if pages < 2 {
				t.Fatalf("pages = %d, want a running header on page 2", pages)
			}
			pdf := filepath.Join(dir, "doc.pdf")
			for p := 1; p <= pages; p++ {
				words := pageWords(t, pdf, p)
				if p > 1 {
					head, ok := topmost(words, "PT.")
					if !ok {
						t.Fatalf("page %d: running header missing", p)
					}
					headBottom, bodyTop := head.yMax, paperH
					for _, w := range words {
						if w.yMin < head.yMin {
							t.Errorf("page %d: %q prints above the running header", p, w.text)
						}
						if near(w.yMin, head.yMin, 1) {
							headBottom = max(headBottom, w.yMax)
						} else {
							bodyTop = min(bodyTop, w.yMin)
						}
					}
					if head.yMin < margin-3 || head.yMin > margin {
						t.Errorf("page %d: header box starts at y=%.1f, want within 3 pt above %.1f", p, head.yMin, margin)
					}
					if gap := bodyTop - headBottom; gap < 4 {
						t.Errorf("page %d: header ends at y=%.1f, content starts at y=%.1f, want a 4 pt gap", p, headBottom, bodyTop)
					}
				}

				of, ok := lowest(words, "of")
				if !ok {
					t.Fatalf("page %d: page count missing", p)
				}
				for _, w := range words {
					if w.yMin > of.yMin+1 {
						t.Errorf("page %d: %q prints below the page count", p, w.text)
					}
				}
				// The box adds the font's descent below the baseline.
				if of.yMax > paperH-margin+2.5 {
					t.Errorf("page %d: page count ends at y=%.1f, inside the %.1f pt margin", p, of.yMax, margin)
				}
			}
		})
	}
}

// ruleAbove finds the table's last rule.
// It is the lowest row above y0 dark across most of the text width.
func ruleAbove(img image.Image, y0 int) int {
	b := img.Bounds()
	for y := min(y0, b.Max.Y) - 1; y >= b.Min.Y; y-- {
		n := 0
		for x := b.Min.X; x < b.Max.X; x++ {
			if dark(img, x, y) {
				n++
			}
		}
		if float64(n) > 0.9*(paperW-2*margin)*edgeDPI/72 {
			return y
		}
	}
	return -1
}

// Blank space stays at the bottom.
// On a one-page document the letterhead starts at the top margin, the block
// after the table follows its last rule by the template's fixed gap plus at
// most the leading of its first line, and the leftover space runs from the
// last line down to the page count.
func TestLatexExports_BlankAtBottom(t *testing.T) {
	docs := []struct {
		name, tmpl, after string
		gap               float64
		data              map[string]any
	}{
		{"quotation", "quotation/Quotation.tex.tmpl", "DELIVERY", 0.8 * cm, quotationData(sampleItems(2))},
		{"invoice", "invoice/Invoice.tex.tmpl", "PAYMENT", 0.8 * cm, invoiceData(sampleItems(2))},
		{"delivery note", "delivery_note/DeliveryNote.tex.tmpl", "Seen", 1.0 * cm, deliveryNoteData(sampleItems(2))},
	}
	const px = float64(edgeDPI) / 72
	for _, d := range docs {
		t.Run(d.name, func(t *testing.T) {
			log, dir := compileDir(t, d.tmpl, d.data)
			if !producedOutput(log) {
				t.Skip("xelatex produced no output")
			}
			if pages := pageCount(log); pages != 1 {
				t.Fatalf("pages = %d, want 1", pages)
			}
			pdf := filepath.Join(dir, "doc.pdf")
			words := firstPageWords(t, pdf)
			after, ok := topmost(words, d.after)
			if !ok {
				t.Fatalf("%q not on page 1", d.after)
			}
			of, ok := lowest(words, "of")
			if !ok {
				t.Fatal("page count not on page 1")
			}
			img := renderPage(t, pdf, 1)
			b := img.Bounds()
			inkRow := func(y int) bool {
				for x := b.Min.X; x < b.Max.X; x++ {
					if dark(img, x, y) {
						return true
					}
				}
				return false
			}

			rule := ruleAbove(img, int(after.yMin*px))
			if rule < 0 {
				t.Fatal("no table rule above the block after the table")
			}
			next := rule + 1
			for next < b.Max.Y && !inkRow(next) {
				next++
			}
			// One line of party text leads by at most 9.5 pt.
			if gap := float64(next-rule-1) / px; gap < d.gap || gap > d.gap+9.5 {
				t.Errorf("block starts %.1f pt below the table, want %.1f to %.1f", gap, d.gap, d.gap+9.5)
			}

			// A centred page would split the blank between top and bottom.
			if top, _, _, _ := inkBox(img); !near(top, margin, inkTol) {
				t.Errorf("first mark at y=%.1f, want the top margin %.1f", top, margin)
			}
			last := int(of.yMin*px) - 1
			for last > next && !inkRow(last) {
				last--
			}
			if blank := of.yMin - float64(last+1)/px; blank < paperH/3 {
				t.Errorf("last line ends at y=%.1f, only %.1f pt above the page count", float64(last+1)/px, blank)
			}
		})
	}
}
