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
// The band runs from the first party label down to the table header, so
// the letterhead copy of an address word ("Gedung", "Jl.", "Jakarta") and
// the item table below never stand in for the party block's own word.
func partyBand(t *testing.T, words []pdfWord, first string) []pdfWord {
	t.Helper()
	top, ok := topmost(words, first)
	if !ok {
		t.Fatalf("%s row not found on page 1", first)
	}
	end, ok := topmost(words, "Qty")
	if !ok || end.yMin <= top.yMin {
		t.Fatal("table header not found below the party block")
	}
	band := make([]pdfWord, 0, len(words))
	for _, w := range words {
		if w.yMin >= top.yMin-1 && w.yMin < end.yMin {
			band = append(band, w)
		}
	}
	return band
}

// Party blocks wrap long fields.
// A long legal name and a full office address must wrap inside the left
// party column: no bad box, and every word whole (English patterns must not
// hyphenate Indonesian names) and left of the right-hand block.
func TestLatexExports_LongPartyWraps(t *testing.T) {
	nameWords := strings.Fields(partyName)
	addressWords := append(strings.Fields(partyAddress), nameWords...)
	docs := []struct {
		name, tmpl, first, label string
		words                    []string
		data                     map[string]any
	}{
		{"quotation", "quotation/Quotation.tex.tmpl", "To", "Your", nameWords, quotationData(sampleItems(2))},
		{"delivery note", "delivery_note/DeliveryNote.tex.tmpl", "To", "Date", addressWords, deliveryNoteData(sampleItems(2))},
		{"invoice", "invoice/Invoice.tex.tmpl", "Client", "PO", addressWords, invoiceData(sampleItems(2))},
		{"invoice long", "invoice/Invoice.tex.tmpl", "Client", "PO", addressWords, invoiceData(sampleItems(6))},
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

			words := partyBand(t, firstPageWords(t, filepath.Join(dir, "doc.pdf")), d.first)
			label, ok := topmost(words, d.label)
			if !ok {
				t.Fatalf("label %q not found on page 1", d.label)
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
		{"invoice", "invoice/Invoice.tex.tmpl", invoiceData},
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
