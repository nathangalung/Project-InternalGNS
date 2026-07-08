package invoices

import (
	"bytes"
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"text/template"
)

func makeInvItem(n int) exportItem {
	return exportItem{
		No:          n,
		Qty:         "1",
		Unit:        "PCS",
		Name:        "Test Item",
		Description: "",
		UnitPrice:   "Rp 100.000",
		Amount:      "Rp 100.000",
	}
}

func renderInvTexWithLog(t *testing.T, root string, data exportData) (pdf []byte, latexLog string) {
	t.Helper()
	tmplPath := filepath.Join(root, "invoice/Invoice.tex.tmpl")
	tmpl, err := template.New("Invoice.tex.tmpl").
		Delims("[[", "]]").
		ParseFiles(tmplPath)
	if err != nil {
		t.Fatalf("parse template: %v", err)
	}
	var buf bytes.Buffer
	if err := tmpl.ExecuteTemplate(&buf, "Invoice.tex.tmpl", data); err != nil {
		t.Fatalf("execute template: %v", err)
	}

	dir, _ := os.MkdirTemp("", "pdfsmoke-i-*")
	t.Cleanup(func() { os.RemoveAll(dir) })

	texPath := filepath.Join(dir, "doc.tex")
	if err := os.WriteFile(texPath, buf.Bytes(), 0o644); err != nil {
		t.Fatalf("write tex: %v", err)
	}

	for i := 0; i < 2; i++ {
		cmd := exec.CommandContext(context.Background(), "xelatex",
			"-interaction=nonstopmode", "-halt-on-error",
			"-output-directory="+dir, texPath)
		cmd.Dir = dir
		var out bytes.Buffer
		cmd.Stdout = &out
		cmd.Stderr = &out
		if err := cmd.Run(); err != nil {
			t.Fatalf("xelatex pass %d failed: %v\nlog:\n%s", i+1, err, out.String())
		}
		if i == 1 {
			latexLog = out.String()
		}
	}

	pdf, err = os.ReadFile(filepath.Join(dir, "doc.pdf"))
	if err != nil {
		t.Fatalf("read pdf: %v", err)
	}
	return pdf, latexLog
}

func TestInvoicePaperSize(t *testing.T) {
	if _, err := exec.LookPath("xelatex"); err != nil {
		t.Skip("xelatex not in PATH")
	}
	if _, err := exec.LookPath("pdfinfo"); err != nil {
		t.Skip("pdfinfo not in PATH")
	}
	root, _ := filepath.Abs("../../templates/documents")
	if _, err := os.Stat(root); os.IsNotExist(err) {
		t.Skipf("templates not found at %s", root)
	}
	outDir := "/tmp/pdfsmoke-papersize"
	if err := os.MkdirAll(outDir, 0o755); err != nil {
		t.Fatal(err)
	}

	cases := []struct {
		name      string
		itemCount int
		wantA4    bool
	}{
		{"3_items_A5", 3, false},
		{"7_items_A4", 7, true},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			items := make([]exportItem, tc.itemCount)
			for i := range items {
				items[i] = makeInvItem(i + 1)
			}
			data := exportData{
				InvoiceNo:       "INV-TEST-001",
				PONo:            "PO-TEST-001",
				PODate:          "8 July 2026",
				CompanyName:     "PT Test Client",
				CompanyNPWP:     "12.345.678.9-000.000",
				CompanyAddress:  "Jl. Test No. 1, Jakarta",
				VesselName:      "MV Test",
				InvoiceDate:     "8 July 2026",
				DueDate:         "8 August 2026",
				Items:           items,
				TotalProduk:     "Rp 100.000",
				Diskon:          "",
				DiscountPct:     "0",
				DPP:             "Rp 90.909",
				DPPNilaiLain:    "Rp 9.091",
				PPN:             "Rp 10.909",
				Total:           "Rp 111.818",
				PaymentTerms:    "30 days",
				BankName:        "Bank BCA",
				BankAccountNo:   "123-456-789",
				BankAccountName: "PT Global Niaga Sakti",
				DateLine:        "Jakarta, 8 July 2026",
				SignerName:      "Director",
				UseA4:           tc.wantA4,
			}

			pdf, latexLog := renderInvTexWithLog(t, root, data)

			out := filepath.Join(outDir, "invoice_"+tc.name+".pdf")
			_ = os.WriteFile(out, pdf, 0o644)

			info, _ := exec.Command("pdfinfo", out).Output()
			infoStr := string(info)
			wantDesc := "A5"
			if tc.wantA4 {
				wantDesc = "A4"
			}
			hasA4 := strings.Contains(infoStr, "A4") || strings.Contains(infoStr, "841")
			overfull := strings.Count(latexLog, "Overfull \\hbox")
			t.Logf("want=%s  pdfinfo_A4=%v  overfull_hbox=%d  bytes=%d  path=%s",
				wantDesc, hasA4, overfull, len(pdf), out)

			if tc.wantA4 && !hasA4 {
				t.Errorf("wanted A4 but pdfinfo shows: %s", infoStr)
			}
			if !tc.wantA4 && hasA4 {
				t.Errorf("wanted A5 but pdfinfo shows A4: %s", infoStr)
			}
			if overfull > 0 {
				t.Logf("WARNING: %d overfull hbox(es) in log", overfull)
			}
		})
	}
}
