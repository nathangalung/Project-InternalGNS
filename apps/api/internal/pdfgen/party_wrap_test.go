package pdfgen

import (
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
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

// partyBand keeps the party rows.
// The band runs from the To row down to the document title, so the
// letterhead copy of an address word ("Gedung", "Jl.", "Jakarta") and the
// item table below never stand in for the party block's own word.
func partyBand(t *testing.T, words []pdfWord, title string) []pdfWord {
	t.Helper()
	to, ok := topmost(words, "To")
	if !ok {
		t.Fatal("To row not found on page 1")
	}
	end, ok := topmost(words, title)
	if !ok || end.yMin <= to.yMin {
		t.Fatalf("title %q not found below the To row", title)
	}
	band := make([]pdfWord, 0, len(words))
	for _, w := range words {
		if w.yMin >= to.yMin-1 && w.yMin < end.yMin {
			band = append(band, w)
		}
	}
	return band
}

// Party blocks wrap long fields.
// A long legal name and a full office address must wrap inside the left
// party column: no bad box, every word whole (English patterns must not
// hyphenate Indonesian names) and left of the document-number block, and
// the document number still one intact word.
func TestLatexExports_LongPartyWraps(t *testing.T) {
	nameWords := strings.Fields(partyName)
	addressWords := append(strings.Fields(partyAddress), nameWords...)
	invoiceA4 := invoiceData(sampleItems(6))
	invoiceA4["UseA4"] = true
	docs := []struct {
		name, tmpl, title, label, number string
		words                            []string
		data                             map[string]any
	}{
		{"quotation", "quotation/Quotation.tex.tmpl", "QUOTATION", "Your", "Q-26400393/GNS/IV/2026", nameWords, quotationData(sampleItems(2))},
		{"delivery note", "delivery_note/DeliveryNote.tex.tmpl", "DELIVERY", "Delivery", "DN-26778001/GNS/IV/2026", addressWords, deliveryNoteData(sampleItems(2))},
		{"invoice A5", "invoice/Invoice.tex.tmpl", "INVOICE", "Invoice", "INV-26400393/GNS/IV/2026", addressWords, invoiceData(sampleItems(2))},
		{"invoice A4", "invoice/Invoice.tex.tmpl", "INVOICE", "Invoice", "INV-26400393/GNS/IV/2026", addressWords, invoiceA4},
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

			words := partyBand(t, firstPageWords(t, filepath.Join(dir, "doc.pdf")), d.title)
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
					t.Errorf("party word %q not found whole in the party block", pw)
					continue
				}
				if w.xMax >= label.xMin {
					t.Errorf("party word %q ends at x=%.1f, past the %q block at x=%.1f", pw, w.xMax, d.label, label.xMin)
				}
			}
		})
	}
}

// Party tokens wrap too.
// One unbroken 89-character token in the client name wraps only through
// LatexBreakable's break points; the escaped control proves the check bites.
func TestLatexExports_LongPartyTokenWraps(t *testing.T) {
	token := "PT.GlobalMaritime" + strings.Repeat("Nusantara", 7) + "Persada07"
	if len(token) != 89 {
		t.Fatalf("token has %d characters, want 89", len(token))
	}
	docs := []struct {
		name, tmpl string
		data       func(items []map[string]any) map[string]any
	}{
		{"quotation", "quotation/Quotation.tex.tmpl", quotationData},
		{"delivery note", "delivery_note/DeliveryNote.tex.tmpl", deliveryNoteData},
		{"invoice A5", "invoice/Invoice.tex.tmpl", invoiceData},
	}
	for _, d := range docs {
		t.Run(d.name, func(t *testing.T) {
			data := d.data(sampleItems(2))
			data["CompanyName"] = LatexBreakable(token)
			log := compileLog(t, d.tmpl, data)
			if !producedOutput(log) {
				t.Skip("xelatex produced no output")
			}
			if over, under, warn := badBoxes(log); over != 0 || under != 0 || warn != 0 {
				t.Errorf("breakable: overfull=%d underfull=%d warnings=%d, want all 0", over, under, warn)
			}

			data["CompanyName"] = LatexEscape(token)
			if over, _, _ := badBoxes(compileLog(t, d.tmpl, data)); over == 0 {
				t.Error("escaped control: no overfull box, so the check cannot catch an overflow")
			}
		})
	}
}
