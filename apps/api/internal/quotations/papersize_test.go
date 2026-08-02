package quotations

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

func makeQItem(n int) exportItem {
	return exportItem{
		No:        n,
		Qty:       "1",
		Unit:      "PCS",
		Request:   "Test Item",
		Offer:     "Test Item",
		HasOffer:  true,
		UnitPrice: "Rp 100.000",
		Amount:    "Rp 100.000",
	}
}

func renderQtexWithLog(t *testing.T, root string, data exportData) (pdf []byte, latexLog string) {
	t.Helper()
	tmplPath := filepath.Join(root, "quotation/Quotation.tex.tmpl")
	tmpl, err := template.New("Quotation.tex.tmpl").
		Delims("[[", "]]").
		ParseFiles(tmplPath)
	if err != nil {
		t.Fatalf("parse template: %v", err)
	}
	var buf bytes.Buffer
	if err := tmpl.ExecuteTemplate(&buf, "Quotation.tex.tmpl", data); err != nil {
		t.Fatalf("execute template: %v", err)
	}

	dir, _ := os.MkdirTemp("", "pdfsmoke-q-*")
	// Stage shared images like Renderer.
	if assets, err := os.ReadDir("../../templates/assets"); err == nil {
		for _, e := range assets {
			if e.IsDir() {
				continue
			}
			b, _ := os.ReadFile(filepath.Join("../../templates/assets", e.Name()))
			_ = os.WriteFile(filepath.Join(dir, e.Name()), b, 0o644)
		}
	}
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

func TestQuotationPaperSize(t *testing.T) {
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
				items[i] = makeQItem(i + 1)
			}
			data := exportData{
				QuotationNo:   "Q-TEST-001",
				ClientRefNo:   "REF-001",
				CompanyName:   "PT Test Client",
				AttnName:      "Test Person",
				AttnEmail:     "test@example.com",
				AttnPhone:     "+62 800 0000",
				DateLine:      "Jakarta, 8 July 2026",
				Items:         items,
				TotalProduk:   "Rp 100.000",
				DiscountPct:   "0",
				TotalDiscount: "Rp 0",
				Subtotal:      "Rp 100.000",
				DPP:           "Rp 90.909",
				PPN:           "Rp 10.909",
				GrandTotal:    "Rp 111.818",
				DeliveryPlace: "Jakarta",
				DeliveryTime:  "7 days",
				Payment:       "30 days",
				Validity:      "14 days",
				SignerName:    "Director",
				UseA4:         tc.wantA4,
			}

			pdf, latexLog := renderQtexWithLog(t, root, data)

			out := filepath.Join(outDir, "quotation_"+tc.name+".pdf")
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
				for _, line := range strings.Split(latexLog, "\n") {
					if strings.Contains(line, "Overfull") {
						t.Logf("  %s", strings.TrimSpace(line))
					}
				}
				t.Logf("WARNING: %d overfull hbox(es) in log", overfull)
			}
		})
	}
}
