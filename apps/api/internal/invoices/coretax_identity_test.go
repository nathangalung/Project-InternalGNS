package invoices

import (
	"errors"
	"testing"
	"time"

	"github.com/nathangalung/internalgns/apps/api/internal/clients"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/deps"
)

// Indonesian buyers need an NPWP.
// Labelling them a passport holder files a tax invoice DJP cannot match to
// the buyer.
func TestValidateBuyerIdentity(t *testing.T) {
	t.Parallel()
	ptr := func(s string) *string { return &s }
	cases := []struct {
		name    string
		client  clients.Client
		wantErr bool
	}{
		{name: "idn with npwp", client: clients.Client{CountryCode: "IDN", NPWP: ptr("0123456789012345")}},
		{name: "idn with printed npwp", client: clients.Client{CountryCode: "IDN", NPWP: ptr("01.234.567.89.012.345")}},
		{name: "idn without npwp", client: clients.Client{CountryCode: "IDN"}, wantErr: true},
		{name: "idn with short npwp", client: clients.Client{CountryCode: "IDN", NPWP: ptr("012345678901234")}, wantErr: true},
		{name: "blank country defaults to idn", client: clients.Client{NPWP: ptr("")}, wantErr: true},
		{name: "foreign without npwp", client: clients.Client{CountryCode: "SGP"}},
		{name: "foreign with own tax id", client: clients.Client{CountryCode: "SGP", NPWP: ptr("SG-9988")}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			err := validateBuyerIdentity(tc.client)
			if tc.wantErr != (err != nil) {
				t.Fatalf("validateBuyerIdentity() error = %v, wantErr %v", err, tc.wantErr)
			}
			if tc.wantErr && !errors.Is(err, ErrBuyerIdentity) {
				t.Fatalf("want ErrBuyerIdentity, got %v", err)
			}
		})
	}
}

// Printed NPWP reaches Coretax normalized.
// Coretax validates the bare 16 digits.
func TestCoretaxInvoiceFor_EmitsNormalizedTin(t *testing.T) {
	t.Parallel()
	npwp := "01.234.567.89.012.345"
	tx := coretaxInvoiceFor(
		deps.CoretaxSettings{SellerTIN: "9999999999999999", SellerIDTKU: "9999999999999999000000"},
		Invoice{InvoiceNo: "INV/2026/0001", InvoiceDate: time.Now(), CompanyName: "PT Buyer", CompanyNpwp: &npwp},
		nil,
		clients.Client{Name: "PT Buyer", CountryCode: "IDN"},
	)
	if tx.BuyerTin != "0123456789012345" {
		t.Fatalf("want normalized TIN, got %q", tx.BuyerTin)
	}
	if tx.BuyerIDTKU != "0123456789012345000000" {
		t.Fatalf("want normalized IDTKU, got %q", tx.BuyerIDTKU)
	}
	if tx.BuyerDocument != "TIN" {
		t.Fatalf("want BuyerDocument TIN, got %q", tx.BuyerDocument)
	}
}
