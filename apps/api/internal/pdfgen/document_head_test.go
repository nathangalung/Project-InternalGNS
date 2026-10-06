package pdfgen

import (
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// pdfText reads every page's text.
func pdfText(t *testing.T, pdf string) string {
	t.Helper()
	bin, err := exec.LookPath("pdftotext")
	if err != nil {
		t.Skip("pdftotext unavailable")
	}
	out, err := exec.Command(bin, "-layout", pdf, "-").Output()
	if err != nil {
		t.Fatalf("pdftotext: %v", err)
	}
	return string(out)
}

// pageSize reads pdfinfo's size line.
func pageSize(t *testing.T, pdf string) string {
	t.Helper()
	bin, err := exec.LookPath("pdfinfo")
	if err != nil {
		t.Skip("pdfinfo unavailable")
	}
	out, err := exec.Command(bin, pdf).Output()
	if err != nil {
		t.Fatalf("pdfinfo: %v", err)
	}
	for _, ln := range strings.Split(string(out), "\n") {
		if strings.HasPrefix(ln, "Page size:") {
			return ln
		}
	}
	t.Fatal("pdfinfo printed no page size")
	return ""
}

// Document heads print alike.
// Every document is A4 portrait at any length, opens with its title and its number
// centred and large under the letterhead, goes straight from the party
// block into the table with no lead-in sentence, and prints no dash or
// semicolon. The delivery note names no vessel or attention, and the
// invoice addresses its Client, also without a vessel.
func TestLatexExports_DocumentHead(t *testing.T) {
	docs := []struct {
		name, tmpl, title, number string
		data                      map[string]any
		want, never               []string
	}{
		{"quotation", "quotation/Quotation.tex.tmpl", "QUOTATION", "Q-26400393/GNS/IV/2026",
			quotationData(sampleItems(2)),
			[]string{"To", "Attn", "Your Ref No."},
			[]string{"We are pleased", "quote as follow"}},
		{"quotation long", "quotation/Quotation.tex.tmpl", "QUOTATION", "Q-26400393/GNS/IV/2026",
			quotationData(sampleItems(9)), nil, nil},
		{"delivery note", "delivery_note/DeliveryNote.tex.tmpl", "DELIVERY", "DN-26778001/GNS/IV/2026",
			deliveryNoteData(sampleItems(2)),
			[]string{"To", "Address", "PO No"},
			[]string{"Vessel", "Attn", "Mohon diterima", "barang-barang berikut"}},
		{"invoice", "invoice/Invoice.tex.tmpl", "INVOICE", "INV-26400393/GNS/IV/2026",
			invoiceData(sampleItems(2)),
			[]string{"Client", "NPWP", "Address", "PO No"},
			[]string{"Vessel", "MV Global Star", "To :"}},
		{"invoice long", "invoice/Invoice.tex.tmpl", "INVOICE", "INV-26400393/GNS/IV/2026",
			invoiceData(sampleItems(9)), nil, nil},
	}
	for _, d := range docs {
		t.Run(d.name, func(t *testing.T) {
			log, dir := compileDir(t, d.tmpl, d.data)
			if !producedOutput(log) {
				t.Skip("xelatex produced no output")
			}
			if over, under, warn := badBoxes(log); over != 0 || under != 0 || warn != 0 {
				t.Errorf("overfull=%d underfull=%d warnings=%d, want all 0", over, under, warn)
				for _, ln := range strings.Split(log, "\n") {
					if strings.Contains(ln, "full \\") {
						t.Log(ln)
					}
				}
			}
			pdf := filepath.Join(dir, "doc.pdf")
			if size := pageSize(t, pdf); !strings.Contains(size, "595.28 x 841.89 pts (A4)") {
				t.Errorf("paper: %s, want A4 portrait", size)
			}
			text := pdfText(t, pdf)
			for _, w := range d.want {
				if !strings.Contains(text, w) {
					t.Errorf("missing %q", w)
				}
			}
			for _, w := range d.never {
				if strings.Contains(text, w) {
					t.Errorf("prints %q", w)
				}
			}
			for _, mark := range []string{"–", "—", ";"} {
				if strings.Contains(text, mark) {
					t.Errorf("prints %q", mark)
				}
			}

			words := firstPageWords(t, pdf)
			title, ok := topmost(words, d.title)
			if !ok {
				t.Fatalf("title %q not on page 1", d.title)
			}
			number, ok := topmost(words, d.number)
			if !ok {
				t.Fatalf("number %q not one word on page 1", d.number)
			}
			if number.yMin <= title.yMin {
				t.Errorf("number at y=%.1f is not under the title at y=%.1f", number.yMin, title.yMin)
			}
			// Centred: both halves of the page around it within a few points.
			mid := (number.xMin + number.xMax) / 2
			page := pageWidth(words)
			if diff := mid - page/2; diff > 6 || diff < -6 {
				t.Errorf("number centre x=%.1f, page centre %.1f", mid, page/2)
			}
			// Large: wider than the same number at the party block size.
			if w := number.xMax - number.xMin; w < float64(len(d.number))*6 {
				t.Errorf("number is %.1f pt wide, too small to stand out", w)
			}
		})
	}
}

// pageWidth spans the letterhead.
// The letterhead runs margin to margin, so its extremes mirror the page.
func pageWidth(words []pdfWord) float64 {
	lo, hi := words[0].xMin, words[0].xMax
	for _, w := range words {
		lo = min(lo, w.xMin)
		hi = max(hi, w.xMax)
	}
	return lo + hi
}
