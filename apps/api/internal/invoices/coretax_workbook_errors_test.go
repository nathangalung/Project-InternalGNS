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

// A template the builder cannot use is an error, never a partial file.
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

// A template without the data sheets still yields both.
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

// invalidBuyers names each rejected client once, in invoice order.
func TestInvalidBuyers(t *testing.T) {
	t.Parallel()
	npwp := "0000000000000000"
	buyers := map[int64]clients.Client{
		1: {ID: 1, Name: "PT Tanpa NPWP", CountryCode: "IDN"},
		2: {ID: 2, Name: "PT Lengkap", CountryCode: "IDN", NPWP: &npwp},
		3: {ID: 3, Name: "Foreign Co", CountryCode: "SGP"},
		4: {ID: 4, Name: "CV Kosong"},
	}
	cases := []struct {
		name string
		invs []Invoice
		want []string
	}{
		{name: "none invalid", invs: []Invoice{{CompanyClientID: 2}, {CompanyClientID: 3}}, want: []string{}},
		{name: "one buyer on two invoices", invs: []Invoice{{CompanyClientID: 1}, {CompanyClientID: 2}, {CompanyClientID: 1}},
			want: []string{"PT Tanpa NPWP"}},
		{name: "a blank country is Indonesian", invs: []Invoice{{CompanyClientID: 4}, {CompanyClientID: 1}},
			want: []string{"CV Kosong", "PT Tanpa NPWP"}},
		{name: "an unread client is skipped", invs: []Invoice{{CompanyClientID: 99}}, want: []string{}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if got := invalidBuyers(tc.invs, buyers); !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("invalidBuyers = %v, want %v", got, tc.want)
			}
		})
	}
}

// num keeps a cell numeric when it can.
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
