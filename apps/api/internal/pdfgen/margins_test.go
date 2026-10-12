package pdfgen

import (
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
	marginSide  = 0.9 * cm
	marginTop   = 0.4 * cm
	marginBot   = 0.75 * cm
	headHeight  = 12.0
	headSep     = 6.0
	logoWidthPt = 5.2 * cm
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

// Margins and head sizes hold.
// Every document prints 0.9 cm from the sides, its running header 0.4 cm
// from the top and its page count 0.75 cm from the bottom, with the logo
// 5.2 cm wide and the number set smaller than the title above it.
func TestLatexExports_Margins(t *testing.T) {
	docs := []struct {
		name, tmpl, title, number string
		data                      map[string]any
	}{
		{"quotation", "quotation/Quotation.tex.tmpl", "QUOTATION", "Q-26400393/GNS/IV/2026", quotationData(sampleItems(60))},
		{"invoice", "invoice/Invoice.tex.tmpl", "INVOICE", "INV-26400393/GNS/IV/2026", invoiceData(sampleItems(60))},
		{"delivery note", "delivery_note/DeliveryNote.tex.tmpl", "DELIVERY", "DN-26778001/GNS/IV/2026", deliveryNoteData(sampleItems(60))},
	}
	for _, d := range docs {
		t.Run(d.name, func(t *testing.T) {
			log, dir := compileDir(t, d.tmpl, d.data)
			if !producedOutput(log) {
				t.Skip("xelatex produced no output")
			}
			if pageCount(log) < 2 {
				t.Fatalf("pages = %d, want a running header on page 2", pageCount(log))
			}
			pdf := filepath.Join(dir, "doc.pdf")
			words := firstPageWords(t, pdf)

			// Sides: the letterhead runs margin to margin.
			left, right := words[0].xMin, words[0].xMax
			top := words[0]
			for _, w := range words {
				left = min(left, w.xMin)
				right = max(right, w.xMax)
				if w.yMin < top.yMin {
					top = w
				}
			}
			if !near(left, marginSide, 2) {
				t.Errorf("text left at %.1f pt, want %.1f", left, marginSide)
			}
			if !near(right, paperW-marginSide, 2) {
				t.Errorf("text right at %.1f pt, want %.1f", right, paperW-marginSide)
			}

			// Top: page 1 opens under the reserved header band; its first
			// 7 pt line sits a few points below the band.
			if body := marginTop + headHeight + headSep; top.yMin < body || top.yMin > body+9 {
				t.Errorf("page 1 starts at y=%.1f (%q), want within 9 pt under %.1f", top.yMin, top.text, body)
			}
			// The running header prints on the sheet, the margin above it.
			second := pageWords(t, pdf, 2)
			head, ok := topmost(second, "PT.")
			if !ok {
				t.Fatal("running header not on page 2")
			}
			if head.yMin < marginTop || head.yMin > marginTop+3 {
				t.Errorf("running header starts at y=%.1f, want just under %.1f", head.yMin, marginTop)
			}

			// Bottom: the page count sits on the margin.
			of, ok := lowest(words, "of")
			if !ok {
				t.Fatal("page count not on page 1")
			}
			if base := paperH - marginBot; of.yMax > base+3 || of.yMax < base-1 {
				t.Errorf("page count ends at y=%.1f, want its baseline at %.1f", of.yMax, base)
			}

			// Logo: a little smaller than the old 6.6 cm.
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
			if ratio := th / (of.yMax - of.yMin); !near(ratio, 14.4/8, 0.05) {
				t.Errorf("title to page count height ratio %.3f, want %.3f", ratio, 14.4/8)
			}
		})
	}
}
