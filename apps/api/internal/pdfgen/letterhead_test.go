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

// Letterhead text centred on the logo.
// Each side block, from its first line's top ink to its last baseline, has
// its middle on the logo's, and both blocks start on one line. The baseline
// is read under words with no descender: 12920 on the left, Website: on
// the right.
func TestLatexExports_LetterheadCentredOnLogo(t *testing.T) {
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
			if left < 0 || right < 0 || logo < 0 {
				t.Fatalf("letterhead ink missing: left %.1f, logo %.1f, right %.1f", left, logo, right)
			}
			mid := (logo + logoBottom) / 2
			for _, b := range []struct {
				name      string
				got, want float64
			}{
				{"left block middle", (left + baseline("12920")) / 2, mid},
				{"right block middle", (right + baseline("Website:")) / 2, mid},
				{"right block top", right, left},
			} {
				if !near(b.got, b.want, inkTol) {
					t.Errorf("%s at %.1f pt, want %.1f", b.name, b.got, b.want)
				}
			}
		})
	}
}

// ruleBelow finds the letterhead rule.
// It is the first row from y0 down dark across most of the text width, and
// it returns that row and the first one after it.
func ruleBelow(img image.Image, y0 int) (top, end int) {
	b := img.Bounds()
	full := func(y int) bool {
		n := 0
		for x := b.Min.X; x < b.Max.X; x++ {
			if dark(img, x, y) {
				n++
			}
		}
		return float64(n) > 0.9*(paperW-2*margin)*edgeDPI/72
	}
	for y := max(y0, b.Min.Y); y < b.Max.Y; y++ {
		if full(y) {
			end = y
			for end < b.Max.Y && full(end) {
				end++
			}
			return y, end
		}
	}
	return -1, -1
}

// Rule sits nearer the logo.
// The rule under the letterhead is closer to the logo above it than to the
// title below it, so it closes the letterhead instead of opening the title.
func TestLatexExports_RuleNearLogo(t *testing.T) {
	const px = float64(edgeDPI) / 72
	for _, d := range longDocs {
		t.Run(d.name, func(t *testing.T) {
			log, dir := compileDir(t, d.tmpl, d.data)
			if !producedOutput(log) {
				t.Skip("xelatex produced no output")
			}
			img := renderPage(t, filepath.Join(dir, "doc.pdf"), 1)
			w := img.Bounds().Dx()
			bandPt := 3 * cm * px
			band := int(bandPt) // letterhead band
			_, logoBottom := inkRows(img, w*36/100, w*64/100, 0, band)
			if logoBottom < 0 {
				t.Fatal("logo ink missing")
			}
			rule, end := ruleBelow(img, int(logoBottom*px))
			if rule < 0 {
				t.Fatal("no rule under the letterhead")
			}
			title, _ := inkRows(img, 0, w, end, img.Bounds().Max.Y)
			above := float64(rule)/px - logoBottom
			below := title - float64(end)/px
			t.Logf("logo to rule %.1f pt, rule to title %.1f pt", above, below)
			// A clear step, not a tie.
			if above+3 > below {
				t.Errorf("logo to rule %.1f pt, rule to title %.1f pt, want the rule nearer the logo", above, below)
			}
		})
	}
}
