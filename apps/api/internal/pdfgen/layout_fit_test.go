package pdfgen

import (
	"strings"
	"testing"
)

// A5 invoice fits one sheet.
// UseA4 flips above five products, so an A5 invoice holds up to five
// product lines plus a shipping line, with the Diskon row printed.
func TestLatexExports_InvoiceA5OnePage(t *testing.T) {
	withShipping := sampleItems(5)
	withShipping = append(withShipping, map[string]any{
		"No": 6, "Qty": "1", "Unit": "", "Name": "Pengiriman", "Description": "Pelabuhan Tanjung Priok",
		"UnitPrice": "Rp~50.000", "Amount": "Rp~50.000",
	})
	cases := []struct {
		name  string
		items []map[string]any
	}{
		{"two items", sampleItems(2)},
		{"five products and shipping", withShipping},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			log := compileLog(t, "invoice/Invoice.tex.tmpl", invoiceData(c.items))
			if !producedOutput(log) {
				t.Skip("xelatex produced no output")
			}
			if pages := pageCount(log); pages != 1 {
				t.Errorf("pages = %d, want 1", pages)
			}
			if over, under, warn := badBoxes(log); over != 0 || under != 0 || warn != 0 {
				t.Errorf("overfull=%d underfull=%d warnings=%d, want all 0", over, under, warn)
			}
		})
	}
}

// Part numbers wrap in cells.
// A 60-character code with no break point overflows its cell unless it is
// passed through LatexBreakable; the escaped control proves the check bites.
func TestLatexExports_LongPartNumberWraps(t *testing.T) {
	part := "GNS" + strings.Repeat("7X4Q", 14) + "Z"
	if len(part) != 60 {
		t.Fatalf("part number has %d characters, want 60", len(part))
	}
	docs := []struct {
		name, tmpl string
		data       func(items []map[string]any) map[string]any
	}{
		{"invoice A5", "invoice/Invoice.tex.tmpl", invoiceData},
		{"invoice A4", "invoice/Invoice.tex.tmpl", func(items []map[string]any) map[string]any {
			d := invoiceData(items)
			d["UseA4"] = true
			return d
		}},
		{"delivery note", "delivery_note/DeliveryNote.tex.tmpl", deliveryNoteData},
	}
	for _, d := range docs {
		t.Run(d.name, func(t *testing.T) {
			items := sampleItems(2)
			items[0]["Name"] = LatexBreakable(part)
			log := compileLog(t, d.tmpl, d.data(items))
			if !producedOutput(log) {
				t.Skip("xelatex produced no output")
			}
			if over, under, warn := badBoxes(log); over != 0 || under != 0 || warn != 0 {
				t.Errorf("breakable: overfull=%d underfull=%d warnings=%d, want all 0", over, under, warn)
			}

			items[0]["Name"] = LatexEscape(part)
			if over, _, _ := badBoxes(compileLog(t, d.tmpl, d.data(items))); over == 0 {
				t.Error("escaped control: no overfull box, so the check cannot catch an overflow")
			}
		})
	}
}
