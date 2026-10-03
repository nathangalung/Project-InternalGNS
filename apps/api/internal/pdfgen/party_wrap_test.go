package pdfgen

import (
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"testing"
)

// pdfWord is one pdftotext word.
type pdfWord struct {
	text       string
	xMin, xMax float64
	yMin       float64
}

var bboxWordRe = regexp.MustCompile(`<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="[\d.]+">([^<]*)</word>`)

// firstPageWords reads page one's words.
// It skips the test when pdftotext is missing.
func firstPageWords(t *testing.T, pdf string) []pdfWord {
	t.Helper()
	bin, err := exec.LookPath("pdftotext")
	if err != nil {
		t.Skip("pdftotext unavailable")
	}
	out, err := exec.Command(bin, "-bbox", "-f", "1", "-l", "1", pdf, "-").Output()
	if err != nil {
		t.Fatalf("pdftotext: %v", err)
	}
	matches := bboxWordRe.FindAllStringSubmatch(string(out), -1)
	words := make([]pdfWord, 0, len(matches))
	for _, m := range matches {
		xMin, _ := strconv.ParseFloat(m[1], 64)
		yMin, _ := strconv.ParseFloat(m[2], 64)
		xMax, _ := strconv.ParseFloat(m[3], 64)
		words = append(words, pdfWord{text: m[4], xMin: xMin, xMax: xMax, yMin: yMin})
	}
	return words
}

// topmost finds a word's first occurrence.
func topmost(words []pdfWord, text string) (pdfWord, bool) {
	var best pdfWord
	found := false
	for _, w := range words {
		if w.text == text && (!found || w.yMin < best.yMin) {
			best, found = w, true
		}
	}
	return best, found
}

// Party blocks wrap long fields.
// A long legal name and a full office address must wrap inside the left
// party column: no bad box, every word left of the document-number block,
// and the document number still one intact word.
func TestLatexExports_LongPartyWraps(t *testing.T) {
	// Short words that never hyphenate.
	// Tbk ends the name and 10220 ends the address, so an unwrapped cell
	// pushes them furthest right.
	nameWords := []string{"Tbk"}
	addressWords := []string{"Tbk", "BNI", "10220"}
	invoiceA4 := invoiceData(sampleItems(6))
	invoiceA4["UseA4"] = true
	docs := []struct {
		name, tmpl, label, number string
		words                     []string
		data                      map[string]any
	}{
		{"quotation", "quotation/Quotation.tex.tmpl", "Your", "Q-26400393/GNS/IV/2026", nameWords, quotationData(sampleItems(2))},
		{"delivery note", "delivery_note/DeliveryNote.tex.tmpl", "Delivery", "DN-26778001/GNS/IV/2026", addressWords, deliveryNoteData(sampleItems(2))},
		{"invoice A5", "invoice/Invoice.tex.tmpl", "Invoice", "INV-26400393/GNS/IV/2026", addressWords, invoiceData(sampleItems(2))},
		{"invoice A4", "invoice/Invoice.tex.tmpl", "Invoice", "INV-26400393/GNS/IV/2026", addressWords, invoiceA4},
	}
	for _, d := range docs {
		t.Run(d.name, func(t *testing.T) {
			if d.data["CompanyName"] != partyName {
				t.Fatal("fixture does not carry the long party name")
			}
			if _, ok := d.data["CompanyAddress"]; ok && d.data["CompanyAddress"] != partyAddress {
				t.Fatal("fixture does not carry the long party address")
			}
			log, dir := compileDir(t, d.tmpl, d.data)
			if !producedOutput(log) {
				t.Skip("xelatex produced no output")
			}
			if over, under, warn := badBoxes(log); over != 0 || under != 0 || warn != 0 {
				t.Errorf("overfull=%d underfull=%d warnings=%d, want all 0", over, under, warn)
			}

			words := firstPageWords(t, filepath.Join(dir, "doc.pdf"))
			label, ok := topmost(words, d.label)
			if !ok {
				t.Fatalf("label %q not found on page 1", d.label)
			}
			if _, ok := topmost(words, d.number); !ok {
				t.Errorf("document number %q is not one intact word", d.number)
			}
			for _, pw := range d.words {
				w, ok := topmost(words, pw)
				if !ok {
					t.Errorf("party word %q not found on page 1", pw)
					continue
				}
				if w.xMax >= label.xMin {
					t.Errorf("party word %q ends at x=%.1f, past the %q block at x=%.1f", pw, w.xMax, d.label, label.xMin)
				}
			}
		})
	}
}
