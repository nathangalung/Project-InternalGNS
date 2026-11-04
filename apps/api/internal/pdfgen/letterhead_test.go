package pdfgen

import (
	"image"
	"path/filepath"
	"testing"
)

// topInk finds a column band's first ink.
// It scans x0 to x1 from the top down to maxY and returns the first row
// holding a dark pixel, in points, or -1 when the band is blank.
func topInk(img image.Image, x0, x1, maxY int) float64 {
	const px = float64(edgeDPI) / 72
	for y := img.Bounds().Min.Y; y < maxY; y++ {
		for x := x0; x < x1; x++ {
			if dark(img, x, y) {
				return float64(y) / px
			}
		}
	}
	return -1
}

// Logo level with the letterhead.
// The logo's top ink sits on the same line as the first address line on
// the left and the first contact line on the right, so the three blocks
// start together at the top margin.
func TestLatexExports_LogoLevelWithLetterhead(t *testing.T) {
	for _, d := range longDocs {
		t.Run(d.name, func(t *testing.T) {
			log, dir := compileDir(t, d.tmpl, d.data)
			if !producedOutput(log) {
				t.Skip("xelatex produced no output")
			}
			img := renderPage(t, filepath.Join(dir, "doc.pdf"), 1)
			w := img.Bounds().Dx()
			band := 3 * cm * float64(edgeDPI) / 72
			maxY := int(band) // letterhead band
			left := topInk(img, 0, w*30/100, maxY)
			logo := topInk(img, w*36/100, w*64/100, maxY)
			right := topInk(img, w*70/100, w, maxY)
			if left < 0 || logo < 0 || right < 0 {
				t.Fatalf("letterhead ink missing: left %.1f, logo %.1f, right %.1f", left, logo, right)
			}
			for _, b := range []struct {
				name string
				got  float64
			}{{"left", left}, {"right", right}} {
				if !near(logo, b.got, inkTol) {
					t.Errorf("logo top %.1f pt, %s block top %.1f pt, want level", logo, b.name, b.got)
				}
			}
		})
	}
}
