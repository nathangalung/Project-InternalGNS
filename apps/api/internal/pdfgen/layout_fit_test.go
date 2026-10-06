package pdfgen

import (
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// Void and Pengganti marks fit.
// A cancelled Pengganti carries both marks; one A4 sheet still holds five
// products and shipping on one clean page, long tables stay clean, and the
// text layer carries both marks.
func TestLatexExports_InvoiceMarks(t *testing.T) {
	withShipping := sampleItems(5)
	withShipping = append(withShipping, map[string]any{
		"No": 6, "Qty": "1", "Unit": "", "Name": "Pengiriman", "Description": "Pelabuhan Tanjung Priok",
		"UnitPrice": "Rp~50.000", "Amount": "Rp~50.000",
	})
	marked := func(items []map[string]any) map[string]any {
		d := invoiceData(items)
		d["Cancelled"] = true
		d["ReplacesInvoiceNo"] = "INV-26400393 1/GNS/IV/2026"
		return d
	}
	cases := []struct {
		name      string
		data      map[string]any
		wantPages int
	}{
		{"five products and shipping", marked(withShipping), 1},
		{"seven products", marked(sampleItems(7)), 1},
		{"multi-page", marked(sampleItems(60)), 0},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			log, dir := compileDir(t, "invoice/Invoice.tex.tmpl", c.data)
			if !producedOutput(log) {
				t.Skip("xelatex produced no output")
			}
			if over, under, warn := badBoxes(log); over != 0 || under != 0 || warn != 0 {
				t.Errorf("overfull=%d underfull=%d warnings=%d, want all 0", over, under, warn)
			}
			pages := pageCount(log)
			if c.wantPages != 0 && pages != c.wantPages {
				t.Errorf("pages = %d, want %d", pages, c.wantPages)
			}
			bin, err := exec.LookPath("pdftotext")
			if err != nil {
				t.Skip("pdftotext unavailable; the marks are not read back")
			}
			out, err := exec.Command(bin, filepath.Join(dir, "doc.pdf"), "-").Output()
			if err != nil {
				t.Fatalf("pdftotext: %v", err)
			}
			text := string(out)
			// The title or the running head names it on every page; the
			// rotated watermark comes out letter by letter, so it is not counted.
			if got := strings.Count(text, "INVOICE DIBATALKAN"); got < pages {
				t.Errorf("INVOICE DIBATALKAN printed %d times over %d page(s), want one per page", got, pages)
			}
			if !strings.Contains(text, "Pengganti dari") || !strings.Contains(text, "INV-26400393 1/GNS/IV/2026") {
				t.Errorf("Pengganti line missing:\n%s", text)
			}
		})
	}
}

// A short invoice fits one sheet.
// Five product lines plus a shipping line, with the Diskon row printed,
// stay on one A4 sheet.
func TestLatexExports_InvoiceOnePage(t *testing.T) {
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

// Destinations wrap in cells.
// The invoice Description and delivery-note Tujuan cells print the ship
// destination, which can be one long unbroken token; the escaped control
// proves the check bites.
func TestLatexExports_LongDestinationWraps(t *testing.T) {
	dest := "GUDANG" + strings.Repeat("TANJUNGPRIOK", 4) + "BLOKC7"
	docs := []struct {
		name, tmpl, field string
		data              func(items []map[string]any) map[string]any
	}{
		{"invoice A5", "invoice/Invoice.tex.tmpl", "Description", invoiceData},
		{"invoice A4", "invoice/Invoice.tex.tmpl", "Description", func(items []map[string]any) map[string]any {
			d := invoiceData(items)
			d["UseA4"] = true
			return d
		}},
		{"delivery note", "delivery_note/DeliveryNote.tex.tmpl", "ShipDestination", deliveryNoteData},
	}
	for _, d := range docs {
		t.Run(d.name, func(t *testing.T) {
			items := sampleItems(2)
			items[0][d.field] = LatexBreakable(dest)
			log := compileLog(t, d.tmpl, d.data(items))
			if !producedOutput(log) {
				t.Skip("xelatex produced no output")
			}
			if over, under, warn := badBoxes(log); over != 0 || under != 0 || warn != 0 {
				t.Errorf("breakable: overfull=%d underfull=%d warnings=%d, want all 0", over, under, warn)
			}

			items[0][d.field] = LatexEscape(dest)
			if over, _, _ := badBoxes(compileLog(t, d.tmpl, d.data(items))); over == 0 {
				t.Error("escaped control: no overfull box, so the check cannot catch an overflow")
			}
		})
	}
}
