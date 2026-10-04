package invoices

import (
	"bytes"
	"reflect"
	"strings"
	"testing"

	"github.com/xuri/excelize/v2"

	"github.com/nathangalung/internalgns/apps/api/internal/clients"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/deps"
)

// Corrupt template is an error.
func TestBuildCoretaxWorkbook_RefusesBadTemplate(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name    string
		tmpl    []byte
		wantErr string
	}{
		{name: "not a workbook", tmpl: []byte("not a workbook"), wantErr: "open template"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			out, err := buildCoretaxWorkbook(tc.tmpl, deps.CoretaxSettings{}, nil, nil, nil)
			if err == nil || !strings.Contains(err.Error(), tc.wantErr) {
				t.Fatalf("err = %v, want one mentioning %q", err, tc.wantErr)
			}
			if out != nil {
				t.Fatalf("got %d bytes alongside the error", len(out))
			}
		})
	}
}

// Missing data sheets are recreated.
func TestBuildCoretaxWorkbook_RecreatesMissingSheets(t *testing.T) {
	t.Parallel()
	blank := excelize.NewFile()
	var tmpl bytes.Buffer
	if err := blank.Write(&tmpl); err != nil {
		t.Fatalf("write blank workbook: %v", err)
	}
	_ = blank.Close()

	out, err := buildCoretaxWorkbook(tmpl.Bytes(), deps.CoretaxSettings{SellerTIN: "0626381321011000"}, nil, nil, nil)
	if err != nil {
		t.Fatalf("build: %v", err)
	}
	f, err := excelize.OpenReader(bytes.NewReader(out))
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	defer func() { _ = f.Close() }()
	for _, sheet := range []string{coretaxSheetFaktur, coretaxSheetDetail} {
		if idx, _ := f.GetSheetIndex(sheet); idx < 0 {
			t.Errorf("sheet %s missing", sheet)
		}
	}
	if v, _ := f.GetCellValue(coretaxSheetDetail, "A1"); v != "Baris" {
		t.Errorf("DetailFaktur A1 = %q, want the Baris header", v)
	}
}

// invalidBuyers names each fix once.
// Identity is checked as invoiced: a draft names its client, an issued
// invoice names itself, since only a Pengganti changes its buyer.
func TestInvalidBuyers(t *testing.T) {
	t.Parallel()
	npwp := "0000000000000000"
	buyers := map[int64]clients.Client{
		1: {ID: 1, Name: "PT Tanpa NPWP", CountryCode: "IDN"},
		2: {ID: 2, Name: "PT Lengkap", CountryCode: "IDN", NPWP: &npwp},
		3: {ID: 3, Name: "Foreign Co", CountryCode: "SGP"},
		4: {ID: 4, Name: "CV Kosong"},
	}
	draft := func(client int64, withNpwp bool) Invoice {
		inv := Invoice{CompanyClientID: client, CompanyName: buyers[client].Name, Status: StatusDraft}
		if withNpwp {
			inv.CompanyNpwp = &npwp
		}
		return inv
	}
	sent := func(no string, client int64, withNpwp bool) Invoice {
		inv := draft(client, withNpwp)
		inv.InvoiceNo, inv.Status = no, StatusSent
		return inv
	}
	cases := []struct {
		name string
		invs []Invoice
		want refusedBuyers
	}{
		{name: "none invalid", invs: []Invoice{draft(2, true), draft(3, false)},
			want: refusedBuyers{clients: []string{}, invoices: []string{}}},
		{name: "one buyer on two invoices", invs: []Invoice{draft(1, false), draft(2, true), draft(1, false)},
			want: refusedBuyers{clients: []string{"PT Tanpa NPWP"}, invoices: []string{}}},
		{name: "a blank country is Indonesian", invs: []Invoice{draft(4, false), draft(1, false)},
			want: refusedBuyers{clients: []string{"CV Kosong", "PT Tanpa NPWP"}, invoices: []string{}}},
		{name: "an issued invoice names itself", invs: []Invoice{sent("INV-1", 2, false), sent("INV-2", 2, false)},
			want: refusedBuyers{clients: []string{}, invoices: []string{"INV-1", "INV-2"}}},
		{name: "the invoiced npwp wins over the client", invs: []Invoice{sent("INV-3", 1, true)},
			want: refusedBuyers{clients: []string{}, invoices: []string{}}},
		{name: "an unread client is skipped", invs: []Invoice{{CompanyClientID: 99}},
			want: refusedBuyers{clients: []string{}, invoices: []string{}}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if got := invalidBuyers(tc.invs, buyers); !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("invalidBuyers = %+v, want %+v", got, tc.want)
			}
		})
	}
}

// Refusal names both fixes.
func TestBuyerIdentityMessage(t *testing.T) {
	t.Parallel()
	got := buyerIdentityMessage(refusedBuyers{clients: []string{"PT A"}, invoices: []string{"INV-1"}})
	want := "Ekspor Coretax memerlukan NPWP 16 digit untuk pembeli Indonesia. Lengkapi NPWP klien: PT A. " +
		"Invoice yang sudah diterbitkan tetap memakai data klien saat diterbitkan; " +
		"batalkan lalu terbitkan invoice pengganti untuk: INV-1."
	if got != want {
		t.Fatalf("message = %q, want %q", got, want)
	}
}

// num keeps cells numeric.
func TestNum(t *testing.T) {
	t.Parallel()
	cases := []struct {
		in   string
		want any
	}{
		{"1450000", float64(1450000)},
		{"5050833.33", 5050833.33},
		{"UM.0021", "UM.0021"},
	}
	for _, tc := range cases {
		if got := num(tc.in); got != tc.want {
			t.Errorf("num(%q) = %#v, want %#v", tc.in, got, tc.want)
		}
	}
}
