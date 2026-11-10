package invoices

import (
	"reflect"
	"testing"

	"github.com/nathangalung/internalgns/apps/api/internal/clients"
)

// refusedBuyers sorts each invoice.
// Identity is checked as invoiced, drafts included: the buyer is fixed at
// creation, so only a Pengganti changes it, and a paid one never changes.
func TestRefusedBuyers(t *testing.T) {
	t.Parallel()
	npwp := "0000000000000000"
	moved := "1111111111111111"
	tku := "0000000000000000000000"
	typedTku := "0000.0000.0000.0000-000001"
	otherTku := "1111111111111111000000"
	buyers := map[int64]clients.Client{
		1: {ID: 1, Name: "PT Tanpa NPWP", CountryCode: "IDN"},
		2: {ID: 2, Name: "PT Lengkap", CountryCode: "IDN", NPWP: &npwp, TkuID: &tku},
		3: {ID: 3, Name: "Foreign Co", CountryCode: "SGP", TkuID: &otherTku},
		4: {ID: 4, Name: "CV Kosong"},
		5: {ID: 5, Name: "PT Pindah NPWP", CountryCode: "IDN", NPWP: &moved, TkuID: &otherTku},
		6: {ID: 6, Name: "PT TKU Diketik", CountryCode: "IDN", NPWP: &npwp, TkuID: &typedTku},
		7: {ID: 7, Name: "PT Tanpa TKU", CountryCode: "IDN", NPWP: &npwp},
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
		want buyerRefusal
	}{
		{name: "none refused", invs: []Invoice{inv("INV-1", 2, StatusDraft, true), inv("INV-2", 3, StatusSent, false)}},
		{name: "a draft names itself", invs: []Invoice{inv("INV-1", 1, StatusDraft, false), inv("INV-2", 1, StatusDraft, false)},
			want: buyerRefusal{missing: []string{"INV-1", "INV-2"}}},
		{name: "a blank country is Indonesian", invs: []Invoice{inv("INV-3", 4, StatusSent, false)},
			want: buyerRefusal{missing: []string{"INV-3"}}},
		{name: "the client's npwp does not reach it", invs: []Invoice{inv("INV-4", 2, StatusDraft, false)},
			want: buyerRefusal{missing: []string{"INV-4"}}},
		{name: "the invoiced npwp wins over the client", invs: []Invoice{inv("INV-5", 1, StatusSent, true)}},
		{name: "a TKU on another npwp", invs: []Invoice{inv("INV-6", 5, StatusSent, true)},
			want: buyerRefusal{mismatch: []string{"INV-6"}}},
		{name: "a TKU typed with separators matches", invs: []Invoice{inv("INV-7", 6, StatusSent, true)}},
		{name: "no TKU takes the npwp", invs: []Invoice{inv("INV-8", 7, StatusSent, true)}},
		{name: "a foreign buyer has no TKU rule", invs: []Invoice{inv("INV-9", 3, StatusSent, false)}},
		{name: "a paid invoice is past fixing", invs: []Invoice{inv("INV-10", 1, StatusPaid, false), inv("INV-11", 5, StatusPaid, true)},
			want: buyerRefusal{paid: []string{"INV-10", "INV-11"}}},
		{name: "an overdue invoice is still open", invs: []Invoice{inv("INV-12", 1, StatusOverdue, false)},
			want: buyerRefusal{missing: []string{"INV-12"}}},
		{name: "an unread client is skipped", invs: []Invoice{{CompanyClientID: 99}}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if got := refusedBuyers(tc.invs, buyers); !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("refusedBuyers = %+v, want %+v", got, tc.want)
			}
		})
	}
}

// Refusal names each route.
// An open invoice goes through a Pengganti, a paid one is left out.
func TestBuyerRefusalMessage(t *testing.T) {
	t.Parallel()
	missing := "Ekspor Coretax butuh NPWP 16 digit untuk pembeli Indonesia. " +
		"Lengkapi NPWP klien, lalu batalkan dan terbitkan ulang invoice berikut: INV-1, INV-2."
	mismatch := "NPWP klien berubah setelah invoice terbit, jadi ID TKU klien tidak cocok dengan NPWP di invoice. " +
		"Batalkan lalu terbitkan Pengganti untuk invoice berikut: INV-3."
	paid := "Invoice lunas berikut tidak menyimpan NPWP pembeli yang cocok untuk Coretax dan tidak dapat diubah lagi: " +
		"INV-4. Pilih periode ekspor yang tidak memuatnya."
	cases := []struct {
		name string
		in   buyerRefusal
		want string
	}{
		{"none", buyerRefusal{}, ""},
		{"missing", buyerRefusal{missing: []string{"INV-1", "INV-2"}}, missing},
		{"mismatch", buyerRefusal{mismatch: []string{"INV-3"}}, mismatch},
		{"paid", buyerRefusal{paid: []string{"INV-4"}}, paid},
		{"all three", buyerRefusal{missing: []string{"INV-1", "INV-2"}, mismatch: []string{"INV-3"}, paid: []string{"INV-4"}},
			missing + " " + mismatch + " " + paid},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if got := tc.in.message(); got != tc.want {
				t.Fatalf("message = %q, want %q", got, tc.want)
			}
		})
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
