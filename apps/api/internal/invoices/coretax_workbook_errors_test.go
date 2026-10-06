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

// invalidBuyers names each invoice.
// Identity is checked as invoiced, drafts included: the buyer is fixed at
// creation, so only a Pengganti changes it.
func TestInvalidBuyers(t *testing.T) {
	t.Parallel()
	npwp := "0000000000000000"
	buyers := map[int64]clients.Client{
		1: {ID: 1, Name: "PT Tanpa NPWP", CountryCode: "IDN"},
		2: {ID: 2, Name: "PT Lengkap", CountryCode: "IDN", NPWP: &npwp},
		3: {ID: 3, Name: "Foreign Co", CountryCode: "SGP"},
		4: {ID: 4, Name: "CV Kosong"},
	}
	inv := func(no string, client int64, status Status, withNpwp bool) Invoice {
		out := Invoice{InvoiceNo: no, CompanyClientID: client, CompanyName: buyers[client].Name, Status: status}
		if withNpwp {
			out.CompanyNpwp = &npwp
		}
		return out
	}
	cases := []struct {
		name string
		invs []Invoice
		want []string
	}{
		{name: "none invalid", invs: []Invoice{inv("INV-1", 2, StatusDraft, true), inv("INV-2", 3, StatusSent, false)},
			want: []string{}},
		{name: "a draft names itself", invs: []Invoice{inv("INV-1", 1, StatusDraft, false), inv("INV-2", 1, StatusDraft, false)},
			want: []string{"INV-1", "INV-2"}},
		{name: "a blank country is Indonesian", invs: []Invoice{inv("INV-3", 4, StatusSent, false)},
			want: []string{"INV-3"}},
		{name: "the client's npwp does not reach it", invs: []Invoice{inv("INV-4", 2, StatusDraft, false)},
			want: []string{"INV-4"}},
		{name: "the invoiced npwp wins over the client", invs: []Invoice{inv("INV-5", 1, StatusSent, true)},
			want: []string{}},
		{name: "an unread client is skipped", invs: []Invoice{{CompanyClientID: 99}},
			want: []string{}},
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

// Refusal names the Pengganti route.
func TestBuyerIdentityMessage(t *testing.T) {
	t.Parallel()
	got := buyerIdentityMessage([]string{"INV-1", "INV-2"})
	want := "Ekspor Coretax butuh NPWP 16 digit untuk pembeli Indonesia. " +
		"Lengkapi NPWP klien, " +
		"lalu batalkan dan terbitkan ulang invoice berikut: INV-1, INV-2."
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
