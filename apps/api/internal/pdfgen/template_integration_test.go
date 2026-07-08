package pdfgen

import (
	"bytes"
	"path/filepath"
	"strings"
	"testing"
	"text/template"
)

// Parse + execute real shipped templates with representative data to catch
// template-variable drift (typos, removed/renamed struct fields, missing
// keys after refactors). Doesn't need tectonic/xelatex — pure text/template.
// missingkey=error makes any unmapped variable a hard failure.

const repoTemplatesRoot = "../../templates/documents"

func execTemplate(t *testing.T, relPath string, data any) string {
	t.Helper()
	path := filepath.Join(repoTemplatesRoot, relPath)
	tmpl, err := template.New(filepath.Base(path)).
		Delims("[[", "]]").
		Option("missingkey=error").
		Funcs(funcMap()).
		ParseFiles(path)
	if err != nil {
		t.Fatalf("parse %s: %v", relPath, err)
	}
	var buf bytes.Buffer
	if err := tmpl.ExecuteTemplate(&buf, filepath.Base(path), data); err != nil {
		t.Fatalf("execute %s: %v", relPath, err)
	}
	return buf.String()
}

func TestRealTemplate_Invoice(t *testing.T) {
	type item struct {
		No                           int
		Qty, Unit, Name, Description string
		UnitPrice, Amount            string
	}
	data := struct {
		InvoiceNo, PONo, PODate, CompanyName, CompanyNPWP, CompanyAddress, VesselName string
		InvoiceDate, DueDate                                                           string
		Items                                                                          []item
		TotalProduk, Diskon, DiscountPct                                               string
		DPP, DPPNilaiLain, PPN, Total                                                  string
		PaymentTerms, BankName, BankAccountNo, BankAccountName                         string
		DateLine, SignerName                                                           string
		UseA4                                                                          bool
	}{
		InvoiceNo:       "INV-2026-0001",
		PONo:            "PO-2026-0001",
		PODate:          "1 January 2026",
		CompanyName:     "PT Sample",
		CompanyNPWP:     "01.234.567.8-901.000",
		CompanyAddress:  "Jl. Test",
		VesselName:      "MV Test",
		InvoiceDate:     "1 January 2026",
		DueDate:         "31 January 2026",
		Items:           []item{{No: 1, Qty: "1", Unit: "PCS", Name: "X", Description: "Y", UnitPrice: "Rp~100", Amount: "Rp~100"}},
		TotalProduk:     "Rp~100",
		Diskon:          "",
		DiscountPct:     "0",
		DPP:             "Rp~100",
		DPPNilaiLain:    "Rp~91",
		PPN:             "Rp~12",
		Total:           "Rp~112",
		PaymentTerms:    "NET 30",
		BankName:        "BCA",
		BankAccountNo:   "1234567890",
		BankAccountName: "PT GNS",
		DateLine:        "Jakarta, 1 January 2026",
		SignerName:      "Direktur",
		UseA4:           true,
	}
	out := execTemplate(t, "invoice/Invoice.tex.tmpl", data)
	if !strings.Contains(out, `\documentclass`) {
		t.Error("invoice output missing \\documentclass preamble")
	}
	if !strings.Contains(out, "INV-2026-0001") {
		t.Error("invoice output missing InvoiceNo")
	}
}

func TestRealTemplate_Quotation(t *testing.T) {
	type item struct {
		No                        int
		Qty, Unit, Request, Offer string
		HasOffer                  bool
		UnitPrice, Amount         string
	}
	data := struct {
		QuotationNo, ClientRefNo, CompanyName                      string
		AttnName, AttnEmail, AttnPhone, DateLine                   string
		Items                                                      []item
		TotalProduk, DiscountPct, TotalDiscount, Subtotal          string
		DPP, PPN, GrandTotal                                       string
		DeliveryPlace, DeliveryTime, Payment, Validity, SignerName string
		UseA4                                                      bool
	}{
		QuotationNo:   "Q-2026-0001",
		ClientRefNo:   "REF-1",
		CompanyName:   "PT Sample",
		AttnName:      "Budi",
		AttnEmail:     "budi@test",
		AttnPhone:     "0811",
		DateLine:      "Jakarta, 1 January 2026",
		Items:         []item{{No: 1, Qty: "1", Unit: "PCS", Request: "Foo", Offer: "Bar", HasOffer: true, UnitPrice: "Rp~100", Amount: "Rp~100"}},
		TotalProduk:   "Rp~100",
		DiscountPct:   "0",
		TotalDiscount: "Rp~0",
		Subtotal:      "Rp~100",
		DPP:           "Rp~91",
		PPN:           "Rp~12",
		GrandTotal:    "Rp~112",
		DeliveryPlace: "Jakarta",
		DeliveryTime:  "Immediate",
		Payment:       "NET 30",
		Validity:      "30 days",
		SignerName:    "Direktur",
		UseA4:         true,
	}
	out := execTemplate(t, "quotation/Quotation.tex.tmpl", data)
	if !strings.Contains(out, `\documentclass`) {
		t.Error("quotation output missing \\documentclass preamble")
	}
	if !strings.Contains(out, "Q-2026-0001") {
		t.Error("quotation output missing QuotationNo")
	}
}

func TestRealTemplate_DeliveryNote(t *testing.T) {
	type item struct {
		No                               int
		Qty, Unit, Name, ShipDestination string
	}
	data := struct {
		DeliveryNoteNo, PONo, CompanyName, CompanyAddress, AttnName, VesselName string
		DateLine                                                                string
		Items                                                                   []item
		PreparedBy, SenderName                                                  string
	}{
		DeliveryNoteNo: "DN-PO-001",
		PONo:           "PO-001",
		CompanyName:    "PT Sample",
		CompanyAddress: "Jl. Test",
		AttnName:       "Budi",
		VesselName:     "MV Test",
		DateLine:       "Jakarta, 1 January 2026",
		Items:          []item{{No: 1, Qty: "1", Unit: "PCS", Name: "Spare", ShipDestination: "Tg. Priok"}},
		PreparedBy:     "Direktur",
		SenderName:     "Direktur",
	}
	out := execTemplate(t, "delivery_note/DeliveryNote.tex.tmpl", data)
	if !strings.Contains(out, `\documentclass`) {
		t.Error("delivery note output missing \\documentclass preamble")
	}
	if !strings.Contains(out, "DN-PO-001") {
		t.Error("delivery note output missing DeliveryNoteNo")
	}
}
