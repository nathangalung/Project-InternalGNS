package pdfgen

import (
	"image"
	"image/png"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

// edgeDPI renders two pixels a point.
const edgeDPI = 144

// renderPage rasterises page one.
func renderPage(t *testing.T, pdf string) image.Image {
	t.Helper()
	bin, err := exec.LookPath("pdftoppm")
	if err != nil {
		t.Skip("pdftoppm unavailable")
	}
	out := filepath.Join(filepath.Dir(pdf), "page")
	if err := exec.Command(bin, "-r", "144", "-gray", "-png", "-f", "1", "-l", "1", "-singlefile", pdf, out).Run(); err != nil {
		t.Fatalf("pdftoppm: %v", err)
	}
	f, err := os.Open(out + ".png")
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	img, err := png.Decode(f)
	if err != nil {
		t.Fatal(err)
	}
	return img
}

// dark reads one pixel.
func dark(img image.Image, x, y int) bool {
	r, _, _, _ := img.At(x, y).RGBA()
	return r < 0x8000
}

// tableBorders finds the outer rules.
// A table rule runs unbroken down the rows; no glyph does, so the first and
// last columns with a long dark run between y0 and y1 are the borders.
func tableBorders(img image.Image, y0, y1 int) (left, right int) {
	left, right = -1, -1
	b := img.Bounds()
	for x := b.Min.X; x < b.Max.X; x++ {
		run, best := 0, 0
		for y := y0; y < y1 && y < b.Max.Y; y++ {
			if dark(img, x, y) {
				run++
				best = max(best, run)
			} else {
				run = 0
			}
		}
		if best >= (y1-y0)*3/4 {
			if left < 0 {
				left = x
			}
			right = x
		}
	}
	return left, right
}

// Tables meet the text edges.
// The letterhead, the party block and the terms start and end on the same
// lines as the table's outer rules, so nothing reaches past the table
// toward the paper edge.
func TestLatexExports_TableMeetsTextEdges(t *testing.T) {
	docs := []struct {
		name, tmpl string
		data       map[string]any
	}{
		{"quotation", "quotation/Quotation.tex.tmpl", quotationData(sampleItems(3))},
		{"invoice", "invoice/Invoice.tex.tmpl", invoiceData(sampleItems(3))},
		{"delivery note", "delivery_note/DeliveryNote.tex.tmpl", deliveryNoteData(sampleItems(3))},
	}
	for _, d := range docs {
		t.Run(d.name, func(t *testing.T) {
			log, dir := compileDir(t, d.tmpl, d.data)
			if !producedOutput(log) {
				t.Skip("xelatex produced no output")
			}
			pdf := filepath.Join(dir, "doc.pdf")
			words := firstPageWords(t, pdf)
			head, ok := topmost(words, "Qty")
			if !ok {
				t.Fatal("table header not found")
			}
			textLeft, textRight := words[0].xMin, words[0].xMax
			for _, w := range words {
				textLeft = min(textLeft, w.xMin)
				textRight = max(textRight, w.xMax)
			}
			img := renderPage(t, pdf)
			y0 := int(head.yMin*2) + 4
			left, right := tableBorders(img, y0, y0+60)
			if left < 0 {
				t.Fatal("no table border found")
			}
			const tol = 3.0 // pixels, 1.5 pt
			if diff := float64(left) - textLeft*2; diff > tol || diff < -tol {
				t.Errorf("table left at %.1f pt, text left at %.1f pt", float64(left)/2, textLeft)
			}
			if diff := float64(right) - textRight*2; diff > tol || diff < -tol {
				t.Errorf("table right at %.1f pt, text right at %.1f pt", float64(right)/2, textRight)
			}
		})
	}
}
