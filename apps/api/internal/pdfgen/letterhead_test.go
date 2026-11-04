package pdfgen

import (
	"image"
	"image/png"
	"os"
	"path/filepath"
	"testing"
)

// Logo asset has no transparent border.
// The templates size and place the image box, so any clear row or column
// around the mark would leave its visible edges off the letterhead lines.
func TestLogoAsset_NoTransparentBorder(t *testing.T) {
	f, err := os.Open("../../templates/assets/Logo_Vertical.png")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = f.Close() }()
	img, err := png.Decode(f)
	if err != nil {
		t.Fatal(err)
	}
	b := img.Bounds()
	ink := image.Rectangle{}
	for y := b.Min.Y; y < b.Max.Y; y++ {
		for x := b.Min.X; x < b.Max.X; x++ {
			if _, _, _, a := img.At(x, y).RGBA(); a != 0 {
				ink = ink.Union(image.Rect(x, y, x+1, y+1))
			}
		}
	}
	if ink != b {
		t.Errorf("logo ink %v inside image %v, crop the transparent border", ink, b)
	}
}

// inkRows finds a region's first ink run.
// It scans x0 to x1 from row y0 down to y1 and returns, in points, the top
// of the first row holding ink and the bottom of the last row before a
// blank one, or -1 when the region is blank.
func inkRows(img image.Image, x0, x1, y0, y1 int) (top, bottom float64) {
	const px = float64(edgeDPI) / 72
	top, bottom = -1, -1
	for y := y0; y < y1; y++ {
		inked := false
		for x := x0; x < x1 && !inked; x++ {
			inked = dark(img, x, y)
		}
		switch {
		case inked && top < 0:
			top = float64(y) / px
		case !inked && top >= 0:
			return top, float64(y) / px
		}
	}
	if top >= 0 {
		bottom = float64(y1) / px
	}
	return top, bottom
}

// Logo level with the letterhead.
// The logo's top ink sits on the top of the first address and contact
// lines, and its bottom ink on the baseline of the last ones, so the three
// blocks start and end together. The baseline is read under words with no
// descender: 12920 on the left, Website: on the right.
func TestLatexExports_LogoLevelWithLetterhead(t *testing.T) {
	const px = float64(edgeDPI) / 72
	for _, d := range longDocs {
		t.Run(d.name, func(t *testing.T) {
			log, dir := compileDir(t, d.tmpl, d.data)
			if !producedOutput(log) {
				t.Skip("xelatex produced no output")
			}
			pdf := filepath.Join(dir, "doc.pdf")
			img := renderPage(t, pdf, 1)
			w := img.Bounds().Dx()
			bandPt := 3 * cm * px
			band := int(bandPt) // letterhead band
			left, _ := inkRows(img, 0, w*30/100, 0, band)
			logo, logoBottom := inkRows(img, w*36/100, w*64/100, 0, band)
			right, _ := inkRows(img, w*70/100, w, 0, band)

			words := firstPageWords(t, pdf)
			baseline := func(text string) float64 {
				wd, ok := topmost(words, text)
				if !ok {
					t.Fatalf("letterhead word %q missing", text)
				}
				_, b := inkRows(img, int(wd.xMin*px), int(wd.xMax*px), int(wd.yMin*px), int(wd.yMax*px)+1)
				return b
			}
			for _, b := range []struct {
				name      string
				got, want float64
			}{
				{"left block top", left, logo},
				{"right block top", right, logo},
				{"left last baseline", baseline("12920"), logoBottom},
				{"right last baseline", baseline("Website:"), logoBottom},
			} {
				if b.got < 0 || b.want < 0 || !near(b.got, b.want, inkTol) {
					t.Errorf("%s at %.1f pt, logo edge at %.1f pt, want level", b.name, b.got, b.want)
				}
			}
		})
	}
}
