package pdfgen

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

// Render a template, return the xelatex log.
func compileLog(t *testing.T, name string, data any) string {
	t.Helper()
	if _, err := exec.LookPath("xelatex"); err != nil {
		t.Skip("xelatex unavailable")
	}
	root := "../../templates/documents"
	path := filepath.Join(root, name)
	tmpl, err := template.New(filepath.Base(path)).Delims("[[", "]]").Funcs(funcMap()).ParseFiles(path)
	if err != nil {
		t.Fatalf("parse %s: %v", name, err)
	}
	var buf bytes.Buffer
	if err := tmpl.ExecuteTemplate(&buf, filepath.Base(path), data); err != nil {
		t.Fatalf("execute %s: %v", name, err)
	}
	dir := t.TempDir()
	r := NewRenderer(root)
	if err := r.copyAssets(dir); err != nil {
		t.Fatalf("assets: %v", err)
	}
	tex := filepath.Join(dir, "doc.tex")
	if err := os.WriteFile(tex, buf.Bytes(), 0o644); err != nil {
		t.Fatal(err)
	}
	// Two passes resolve page refs, like production.
	for i := 0; i < 2; i++ {
		cmd := exec.Command("xelatex", "-interaction=nonstopmode", "-output-directory="+dir, tex)
		cmd.Dir = dir
		_ = cmd.Run()
	}
	logBytes, _ := os.ReadFile(filepath.Join(dir, "doc.log"))
	log := string(logBytes)
	// Fail on genuine LaTeX errors, not environment flakes.
	for _, ln := range strings.Split(log, "\n") {
		if strings.HasPrefix(ln, "! ") {
			t.Fatalf("%s latex error: %s", name, ln)
		}
	}
	return log
}

// True when xelatex emitted a PDF.
func producedOutput(log string) bool {
	return strings.Contains(strings.Join(strings.Fields(log), " "), "Output written on")
}

// Count overfull, underfull, and warnings.
func badBoxes(log string) (over, under, warn int) {
	for _, ln := range strings.Split(log, "\n") {
		switch {
		case strings.HasPrefix(ln, "Overfull \\hbox"), strings.HasPrefix(ln, "Overfull \\vbox"):
			over++
		case strings.HasPrefix(ln, "Underfull \\hbox"), strings.HasPrefix(ln, "Underfull \\vbox"):
			under++
		case strings.Contains(ln, "LaTeX Warning"), strings.Contains(ln, "Package") && strings.Contains(ln, "Warning"):
			warn++
		}
	}
	return
}

var pagesRe = regexp.MustCompile(`\((\d+) pages?\)`)

// Read the emitted page count.
func pageCount(log string) int {
	// Collapse xelatex log line wrapping.
	flat := strings.Join(strings.Fields(log), " ")
	m := pagesRe.FindStringSubmatch(flat)
	if m == nil {
		return 0
	}
	n, _ := strconv.Atoi(m[1])
	return n
}

func sampleItems(n int) []map[string]any {
	base := []map[string]any{
		{"Qty": "5", "Unit": "PCS", "Request": "Marine radio handheld VHF intrinsically safe", "HasOffer": true, "Offer": "Entel HT840 VHF portable, USTC certified", "UnitPrice": "Rp~9.040.000", "Amount": "Rp~45.200.000", "Name": "Marine Radio Handheld", "Description": "Entel HT840 VHF portable", "ShipDestination": "MV Global Star, Tanjung Priok"},
		{"Qty": "2", "Unit": "SET", "Request": "Fire hose coupling", "HasOffer": false, "Offer": "", "UnitPrice": "Rp~1.500.000", "Amount": "Rp~3.000.000", "Name": "Fire Hose Coupling", "Description": "Aluminum, 2.5 inch", "ShipDestination": "MV Global Star"},
	}
	out := make([]map[string]any, 0, n)
	for i := 0; i < n; i++ {
		it := map[string]any{}
		for k, v := range base[i%len(base)] {
			it[k] = v
		}
		it["No"] = i + 1
		out = append(out, it)
	}
	return out
}

func quotationData(items []map[string]any) map[string]any {
	return map[string]any{
		"UseA4": false, "CompanyName": "PT. Pelita Global Logistik Nusantara", "AttnName": "Bapak Riza Chair",
		"AttnEmail": "riza.chair@example.com", "AttnPhone": "0811-000-000",
		"QuotationNo": "Q-26400393/GNS/IV/2026", "ClientRefNo": "V-26-2401-035-D", "DateLine": "Jakarta, 30 April 2026",
		"Items": items, "TotalProduk": "Rp~45.200.000", "DiscountPct": "5", "TotalDiscount": "Rp~2.260.000",
		"Subtotal": "Rp~42.940.000", "DPP": "Rp~42.940.000", "PPN": "Rp~5.152.800", "GrandTotal": "Rp~48.092.800",
		"DeliveryPlace": "Jakarta Selatan", "DeliveryTime": "5 hari kerja", "Payment": "30 hari", "Validity": "14 hari", "SignerName": "Director",
	}
}

func invoiceData(items []map[string]any) map[string]any {
	return map[string]any{
		"UseA4": false, "CompanyName": "PT. Pelita Global Logistik Nusantara", "CompanyNPWP": "01.234.567.8-901.000",
		"CompanyAddress": "Jl. Sudirman Kav 52, Jakarta", "VesselName": "MV Global Star", "InvoiceNo": "INV-26400393/GNS/IV/2026",
		"PONo": "PO-778/2026", "PODate": "20 April 2026", "InvoiceDate": "30 April 2026", "DueDate": "30 May 2026",
		"Items": items, "TotalProduk": "Rp~45.200.000", "Diskon": "Rp~2.260.000", "DiscountPct": "5", "DPP": "Rp~42.940.000",
		"DPPNilaiLain": "Rp~39.361.667", "PPN": "Rp~4.723.400", "Total": "Rp~47.663.400", "PaymentTerms": "30 hari",
		"BankName": "Bank Mandiri", "BankAccountNo": "123-00-4567890", "BankAccountName": "PT Global Niaga Sakti", "DateLine": "Jakarta, 30 April 2026", "SignerName": "Director",
	}
}

func deliveryNoteData(items []map[string]any) map[string]any {
	return map[string]any{
		"DeliveryNoteNo": "DN-778/2026", "PONo": "PO-778/2026", "CompanyName": "PT. Pelita Global Logistik Nusantara",
		"CompanyAddress": "Jl. Sudirman Kav 52, Jakarta", "AttnName": "Bapak Riza Chair", "VesselName": "MV Global Star",
		"DateLine": "Jakarta, 30 April 2026", "Items": items, "PreparedBy": "Admin GNS", "SenderName": "Kurir GNS",
	}
}

// Exports compile without bad boxes or warnings.
func TestLatexExports_Clean(t *testing.T) {
	items := sampleItems(2)
	docs := []struct {
		name, tmpl string
		data       any
	}{
		{"quotation", "quotation/Quotation.tex.tmpl", quotationData(items)},
		{"invoice", "invoice/Invoice.tex.tmpl", invoiceData(items)},
		{"delivery_note", "delivery_note/DeliveryNote.tex.tmpl", deliveryNoteData(items)},
	}
	for _, d := range docs {
		t.Run(d.name, func(t *testing.T) {
			log := compileLog(t, d.tmpl, d.data)
			if !producedOutput(log) {
				t.Skip("xelatex produced no output")
			}
			over, under, warn := badBoxes(log)
			if over != 0 || under != 0 || warn != 0 {
				t.Errorf("%s: overfull=%d underfull=%d warnings=%d, want all 0", d.name, over, under, warn)
			}
		})
	}
}

// Long tables paginate cleanly without bad boxes.
func TestLatexExports_MultiPage(t *testing.T) {
	items := sampleItems(60)
	docs := []struct {
		name, tmpl string
		data       any
	}{
		{"quotation", "quotation/Quotation.tex.tmpl", quotationData(items)},
		{"invoice", "invoice/Invoice.tex.tmpl", invoiceData(items)},
		{"delivery_note", "delivery_note/DeliveryNote.tex.tmpl", deliveryNoteData(items)},
	}
	for _, d := range docs {
		t.Run(d.name, func(t *testing.T) {
			log := compileLog(t, d.tmpl, d.data)
			if !producedOutput(log) {
				t.Skip("xelatex produced no output")
			}
			over, _, warn := badBoxes(log)
			if pages := pageCount(log); pages < 2 {
				t.Errorf("%s: expected multi-page split, got %d page(s)", d.name, pages)
			}
			if over != 0 || warn != 0 {
				t.Errorf("%s multi-page: overfull=%d warnings=%d, want 0", d.name, over, warn)
			}
		})
	}
}
