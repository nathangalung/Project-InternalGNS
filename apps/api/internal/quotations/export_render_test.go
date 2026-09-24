package quotations

import (
	"bytes"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"testing"
	"text/template"
)

// renderQuotation returns the PDF text, page count and log.
func renderQuotation(t *testing.T, data exportData) (text string, pages int, latexLog string) {
	t.Helper()
	for _, bin := range []string{"xelatex", "pdftotext", "pdfinfo"} {
		if _, err := exec.LookPath(bin); err != nil {
			t.Skipf("%s unavailable", bin)
		}
	}
	root, err := filepath.Abs("../../templates/documents")
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(root, "quotation/Quotation.tex.tmpl")
	tmpl, err := template.New("Quotation.tex.tmpl").Delims("[[", "]]").ParseFiles(path)
	if err != nil {
		t.Fatalf("parse template: %v", err)
	}
	var buf bytes.Buffer
	if err := tmpl.ExecuteTemplate(&buf, "Quotation.tex.tmpl", data); err != nil {
		t.Fatalf("execute template: %v", err)
	}

	dir := t.TempDir()
	assets, err := os.ReadDir("../../templates/assets")
	if err != nil {
		t.Fatalf("assets: %v", err)
	}
	for _, e := range assets {
		if e.IsDir() {
			continue
		}
		b, rerr := os.ReadFile(filepath.Join("../../templates/assets", e.Name()))
		if rerr != nil {
			t.Fatal(rerr)
		}
		if werr := os.WriteFile(filepath.Join(dir, e.Name()), b, 0o644); werr != nil {
			t.Fatal(werr)
		}
	}
	tex := filepath.Join(dir, "doc.tex")
	if err := os.WriteFile(tex, buf.Bytes(), 0o644); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		cmd := exec.Command("xelatex", "-interaction=nonstopmode", "-halt-on-error",
			"-output-directory="+dir, tex)
		cmd.Dir = dir
		var out bytes.Buffer
		cmd.Stdout = &out
		cmd.Stderr = &out
		if err := cmd.Run(); err != nil {
			t.Fatalf("xelatex pass %d: %v\n%s", i+1, err, out.String())
		}
	}
	pdf := filepath.Join(dir, "doc.pdf")

	txt, err := exec.Command("pdftotext", "-layout", pdf, "-").Output()
	if err != nil {
		t.Fatalf("pdftotext: %v", err)
	}
	info, err := exec.Command("pdfinfo", pdf).Output()
	if err != nil {
		t.Fatalf("pdfinfo: %v", err)
	}
	m := regexp.MustCompile(`Pages:\s+(\d+)`).FindStringSubmatch(string(info))
	if m != nil {
		pages, _ = strconv.Atoi(m[1])
	}
	logBytes, err := os.ReadFile(filepath.Join(dir, "doc.log"))
	if err != nil {
		t.Fatalf("read log: %v", err)
	}
	return string(txt), pages, string(logBytes)
}

// sampleExport builds a discounted quotation with shipping.
func sampleExport(productLines int) exportData {
	items := make([]QuotationItem, 0, productLines+1)
	for i := 0; i < productLines; i++ {
		it := productLine(int16(i+1), "PUNCHING TOOL SET DIES & TABLE", "2.00", "1000.50", "2001.00")
		it.OfferedName = qStr("TEKIRO PUNCHING TOOL SET 6-38MM")
		it.OfferedImpa = qStr("613802")
		items = append(items, it)
	}
	items = append(items, shippingLine(int16(productLines+1), "150.25"))

	// One product line: 2.001,00 - 200,10 + 150,25 = 1.951,15 subtotal.
	d := QuotationDetail{
		Quotation: header("2001.00", "2151.25", "200.10", "1951.15", "1788.55", "214.63", "2165.78"),
		Items:     items,
	}
	d.VesselName = qStr("MV GLOBAL STAR")
	d.PaymentTerms = qStr("30 days")
	validity := 14
	d.ValidityDays = &validity
	d.ContactName = qStr("Bapak Riza Chair")
	return buildExportData(d, qUnits, "riza@example.com", "0811-000-000", "Director")
}

// badBoxes lists overfull, underfull and warning lines.
func badBoxes(log string) []string {
	var out []string
	for _, ln := range strings.Split(log, "\n") {
		if strings.HasPrefix(ln, "Overfull \\") || strings.HasPrefix(ln, "Underfull \\") ||
			strings.Contains(ln, "Warning") {
			out = append(out, ln)
		}
	}
	return out
}

// Both paper sizes print the stored figures cleanly.
func TestQuotationPDF_PrintsStoredTotals(t *testing.T) {
	cases := []struct {
		name    string
		lines   int
		wantA4  bool
		onePage bool
	}{
		{"A5", 1, false, true},
		{"A4", 8, true, false},
	}
	wants := []struct{ label, amount string }{
		{"Total Produk", "Rp 2.001,00"},
		{"Diskon 10.00%", "-Rp 200,10"},
		{"Pengiriman", "Rp 150,25"},
		{"Sub Total", "Rp 1.951,15"},
		{"DPP Nilai Lain", "Rp 1.788,55"},
		{"PPN 12%", "Rp 214,63"},
		{"Grand Total", "Rp 2.165,78"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			data := sampleExport(tc.lines)
			if data.UseA4 != tc.wantA4 {
				t.Fatalf("UseA4 = %v, want %v", data.UseA4, tc.wantA4)
			}
			text, pages, log := renderQuotation(t, data)

			flat := strings.Join(strings.Fields(text), " ")
			for _, w := range wants {
				if !strings.Contains(flat, w.label+" "+w.amount) {
					t.Errorf("printed PDF misses %q followed by %q", w.label, w.amount)
				}
			}
			if !strings.Contains(flat, "TEKIRO PUNCHING TOOL SET") || !strings.Contains(flat, "(613802)") {
				t.Error("the offer column must name the catalog item that is supplied")
			}
			if tc.onePage && pages != 1 {
				t.Errorf("pages = %d, want 1", pages)
			}
			for _, ln := range badBoxes(log) {
				t.Errorf("latex: %s", ln)
			}
		})
	}
}

// A short quotation fits one A5 sheet up to five product lines.
func TestQuotationPDF_A5FitsFiveLines(t *testing.T) {
	const longRequest = "MARINE RADIO HANDHELD VHF INTRINSICALLY SAFE WITH SPARE BATTERY AND CHARGER"
	const longOffer = "ENTEL HT844 VHF PORTABLE RADIO, ATEX CERTIFIED, LI-ION 2500MAH BATTERY (370021)"
	cases := []struct {
		name  string
		lines int
		long  bool
	}{
		{"1 line", 1, false},
		{"3 lines", 3, false},
		{"5 lines", 5, false},
		{"5 wrapped lines", 5, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			data := sampleExport(tc.lines)
			if data.UseA4 {
				t.Fatalf("%d lines must still be A5", tc.lines)
			}
			if tc.long {
				for i := 0; i < tc.lines; i++ {
					data.Items[i].Request = longRequest
					data.Items[i].Offer = longOffer
				}
			}
			text, pages, log := renderQuotation(t, data)
			if pages != 1 {
				t.Errorf("pages = %d, want 1", pages)
			}
			if !strings.Contains(text, "1 of 1") {
				t.Error("the page number must print on the sheet")
			}
			if !strings.Contains(text, "Director") {
				t.Error("the signature block must print on the sheet")
			}
			for _, ln := range badBoxes(log) {
				t.Errorf("latex: %s", ln)
			}
		})
	}
}

// Q-16: long part numbers wrap.
func TestQuotationPDF_LongPartNumberWraps(t *testing.T) {
	const part = "HYDRAULICPUMPSEALKITVICKERSV201P13P1C11OEMGENUINE"
	cases := []struct {
		name  string
		lines int
	}{{"A5", 1}, {"A4", 8}}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			items := make([]QuotationItem, 0, tc.lines)
			for i := 0; i < tc.lines; i++ {
				it := productLine(int16(i+1), part, "1.00", "1000.00", "1000.00")
				it.RequestedImpa = qStr("IMPA" + part)
				it.OfferedName = qStr(part)
				items = append(items, it)
			}
			d := QuotationDetail{
				Quotation: header("1000.00", "1000.00", "0.00", "1000.00", "916.67", "110.00", "1110.00"),
				Items:     items,
			}
			data := buildExportData(d, qUnits, "", "", "Director")
			if !strings.Contains(data.Items[0].Request, `\discretionary{}{}{}`) {
				t.Fatalf("Request %q has no break points", data.Items[0].Request)
			}

			// No overfull box means no text ran past its cell.
			_, _, log := renderQuotation(t, data)
			for _, ln := range badBoxes(log) {
				t.Errorf("latex: %s", ln)
			}
		})
	}
}
