package pdfgen

import (
	"math"
	"path/filepath"
	"strings"
	"testing"
)

// wrappedItem is one tall row.
// Its long text wraps to three lines or more; every other cell holds one
// token found nowhere else below the table header.
func wrappedItem(long string) map[string]any {
	return map[string]any{
		"No": 1, "Qty": "37", "Unit": "DRUM", "HasOffer": true,
		"Request": long, "Name": long, "Offer": "Viking", "Description": "Viking",
		"Note": "Priok", "UnitPrice": "Rp1.234.500", "Amount": "Rp45.676.500",
	}
}

// Table cells centre vertically.
// When one text cell wraps, every one-line cell of the row sits on the
// wrapped block's vertical midpoint instead of its first line.
func TestLatexExports_TableCellsCentred(t *testing.T) {
	const short = "Lifebuoy ring SOLAS approved with self igniting light and smoke signal complete with bracket"
	const long = short + " and retro reflective tape, orange, 720 mm, packed with its own spare light"
	docs := []struct {
		name, tmpl, long string
		data             func([]map[string]any) map[string]any
		single           []string
	}{
		{"quotation", "quotation/Quotation.tex.tmpl", short, quotationData,
			[]string{"1", "37", "DRUM", "Viking", "Rp1.234.500", "Rp45.676.500"}},
		{"invoice", "invoice/Invoice.tex.tmpl", short, invoiceData,
			[]string{"1", "37", "DRUM", "Viking", "Rp1.234.500", "Rp45.676.500"}},
		{"delivery note", "delivery_note/DeliveryNote.tex.tmpl", long, deliveryNoteData,
			[]string{"1", "37", "DRUM", "Priok"}},
	}
	for _, d := range docs {
		t.Run(d.name, func(t *testing.T) {
			data := d.data(nil)
			data["Items"] = []map[string]any{wrappedItem(d.long)}
			log, dir := compileDir(t, d.tmpl, data)
			if !producedOutput(log) {
				t.Skip("xelatex produced no output")
			}
			if over, under, warn := badBoxes(log); over != 0 || under != 0 || warn != 0 {
				t.Errorf("overfull=%d underfull=%d warnings=%d, want all 0", over, under, warn)
			}
			words := firstPageWords(t, filepath.Join(dir, "doc.pdf"))
			head, ok := topmost(words, "Qty")
			if !ok {
				t.Fatal("table header not found")
			}

			// The wrapped block, below the header.
			inLong := map[string]bool{}
			for _, w := range strings.Fields(d.long) {
				inLong[w] = true
			}
			top, bottom := math.Inf(1), math.Inf(-1)
			lines := map[int]bool{}
			for _, w := range words {
				if w.yMin > head.yMax && inLong[w.text] {
					top, bottom = min(top, w.yMin), max(bottom, w.yMax)
					lines[int(math.Round(w.yMin))] = true
				}
			}
			if len(lines) < 3 {
				t.Fatalf("wrapped cell prints %d lines, want at least 3", len(lines))
			}
			mid := (top + bottom) / 2

			const tol = 1.5 // points
			for _, s := range d.single {
				var cell pdfWord
				found := false
				for _, w := range words {
					if w.text == s && w.yMin > head.yMax && w.yMin < bottom {
						cell, found = w, true
						break
					}
				}
				if !found {
					t.Errorf("cell %q not found in the row", s)
					continue
				}
				if got := (cell.yMin + cell.yMax) / 2; math.Abs(got-mid) > tol {
					t.Errorf("cell %q centred at y=%.1f, wrapped block at y=%.1f (%.1f to %.1f)", s, got, mid, top, bottom)
				}
			}
		})
	}
}
