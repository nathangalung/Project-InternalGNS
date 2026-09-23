package invoices

import (
	"errors"
	"testing"
	"time"

	"github.com/nathangalung/internalgns/apps/api/internal/clients"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/deps"
)

func TestNormalizeNPWP(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		in   string
		want string
		ok   bool
	}{
		{name: "plain 16 digits", in: "0123456789012345", want: "0123456789012345", ok: true},
		{name: "printed separators", in: "01.234.567.89.012.345", want: "0123456789012345", ok: true},
		{name: "spaces", in: " 0123456789012345 ", want: "0123456789012345", ok: true},
		{name: "legacy 15 digits", in: "01.234.567.8-901.000", want: "012345678901000", ok: false},
		{name: "too long", in: "01234567890123456", want: "01234567890123456", ok: false},
		{name: "letters", in: "PASSPORT123", want: "", ok: false},
		{name: "empty", in: "", want: "", ok: false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got, ok := normalizeNPWP(tc.in)
			if got != tc.want || ok != tc.ok {
				t.Fatalf("normalizeNPWP(%q) = (%q, %v), want (%q, %v)", tc.in, got, ok, tc.want, tc.ok)
			}
		})
	}
}

// An Indonesian buyer must be filed with a real NPWP; labelling them a
// passport holder files a tax invoice DJP cannot match to the buyer.
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

// A printed NPWP must reach Coretax as the 16 digits it validates.
func TestCoretaxInvoiceFor_EmitsNormalizedTin(t *testing.T) {
	t.Parallel()
	npwp := "01.234.567.89.012.345"
	tx := coretaxInvoiceFor(
		deps.CoretaxSettings{SellerTIN: "9999999999999999", SellerIDTKU: "9999999999999999000000"},
		Invoice{InvoiceNo: "INV/2026/0001", InvoiceDate: time.Now()},
		nil,
		clients.Client{Name: "PT Buyer", CountryCode: "IDN", NPWP: &npwp},
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
