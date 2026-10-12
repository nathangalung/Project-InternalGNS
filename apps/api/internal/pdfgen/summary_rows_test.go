package pdfgen

import (
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// Summary rows read alike.
// The quotation and the invoice print the same rows in the same order.
// Shipping is a table line, so it gets no row of its own, and a zero
// discount prints no row.
func TestLatexExports_SummaryRows(t *testing.T) {
	noDiscount := func(d map[string]any) map[string]any {
		d["HasDiscount"] = false
		return d
	}
	untaxed := func(d map[string]any) map[string]any {
		d["WithPPN"] = false
		return d
	}
	all := []string{"Total", "Diskon Produk 5%", "Sub Total", "DPP Nilai Lain", "PPN 12%", "Grand Total"}
	docs := []struct {
		name, tmpl string
		data       map[string]any
		want       []string
	}{
		{"quotation", "quotation/Quotation.tex.tmpl", quotationData(sampleItems(2)), all},
		{"invoice", "invoice/Invoice.tex.tmpl", invoiceData(sampleItems(2)), all},
		{"quotation without discount", "quotation/Quotation.tex.tmpl", noDiscount(quotationData(sampleItems(2))),
			[]string{"Total", "Sub Total", "DPP Nilai Lain", "PPN 12%", "Grand Total"}},
		{"invoice without discount", "invoice/Invoice.tex.tmpl", noDiscount(invoiceData(sampleItems(2))),
			[]string{"Total", "Sub Total", "DPP Nilai Lain", "PPN 12%", "Grand Total"}},
		{"invoice without PPN", "invoice/Invoice.tex.tmpl", untaxed(invoiceData(sampleItems(2))),
			[]string{"Total", "Diskon Produk 5%", "Sub Total", "Grand Total"}},
	}
	// A summary row is its label, then its amount at the line's end.
	row := regexp.MustCompile(`(?m)^\s*([A-Za-z][A-Za-z\d%,]*(?: [A-Za-z\d%,]+)*)\s{2,}-?Rp[\d.,]+\s*$`)
	for _, d := range docs {
		t.Run(d.name, func(t *testing.T) {
			log, dir := compileDir(t, d.tmpl, d.data)
			if !producedOutput(log) {
				t.Skip("xelatex produced no output")
			}
			text := pdfText(t, filepath.Join(dir, "doc.pdf"))
			if strings.Contains(text, "no value") {
				t.Fatal("a template field has no value in the fixture")
			}
			var got []string
			for _, m := range row.FindAllStringSubmatch(text, -1) {
				got = append(got, m[1])
			}
			if strings.Join(got, " | ") != strings.Join(d.want, " | ") {
				t.Errorf("summary rows\n got %q\nwant %q", got, d.want)
			}
		})
	}
}
