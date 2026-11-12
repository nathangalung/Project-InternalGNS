package invoices

import (
	"reflect"
	"testing"

	"github.com/nathangalung/internalgns/apps/api/internal/clients"
)

// refusedBuyers lists each invoice.
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
	var seq int64
	inv := func(no string, client int64, status Status, withNpwp bool) Invoice {
		seq++
		out := Invoice{
			ID: seq, QuotationID: seq + 100, InvoiceNo: no, CompanyClientID: client,
			CompanyName: buyers[client].Name, Status: status,
		}
		if withNpwp {
			out.CompanyNpwp = &npwp
		}
		return out
	}
	refused := func(i Invoice, reason RefusalReason) CoretaxRefusal {
		return CoretaxRefusal{
			InvoiceID: i.ID, QuotationID: i.QuotationID, InvoiceNo: i.InvoiceNo,
			ClientID: i.CompanyClientID, ClientName: i.CompanyName, Reason: reason,
		}
	}
	draft1, draft2 := inv("INV-1", 1, StatusDraft, false), inv("INV-2", 1, StatusDraft, false)
	blank := inv("INV-3", 4, StatusSent, false)
	unread := inv("INV-4", 2, StatusDraft, false)
	tkuMoved := inv("INV-6", 5, StatusSent, true)
	paid1, paid2 := inv("INV-10", 1, StatusPaid, false), inv("INV-11", 5, StatusPaid, true)
	overdue := inv("INV-12", 1, StatusOverdue, false)
	cases := []struct {
		name string
		invs []Invoice
		want buyerRefusal
	}{
		{name: "none refused", invs: []Invoice{inv("INV-1", 2, StatusDraft, true), inv("INV-2", 3, StatusSent, false)}},
		{name: "a draft names itself", invs: []Invoice{draft1, draft2},
			want: buyerRefusal{refused(draft1, ReasonNpwpMissing), refused(draft2, ReasonNpwpMissing)}},
		{name: "a blank country is Indonesian", invs: []Invoice{blank},
			want: buyerRefusal{refused(blank, ReasonNpwpMissing)}},
		{name: "the client's npwp does not reach it", invs: []Invoice{unread},
			want: buyerRefusal{refused(unread, ReasonNpwpMissing)}},
		{name: "the invoiced npwp wins over the client", invs: []Invoice{inv("INV-5", 1, StatusSent, true)}},
		{name: "a TKU on another npwp", invs: []Invoice{tkuMoved},
			want: buyerRefusal{refused(tkuMoved, ReasonTkuMismatch)}},
		{name: "a TKU typed with separators matches", invs: []Invoice{inv("INV-7", 6, StatusSent, true)}},
		{name: "no TKU takes the npwp", invs: []Invoice{inv("INV-8", 7, StatusSent, true)}},
		{name: "a foreign buyer has no TKU rule", invs: []Invoice{inv("INV-9", 3, StatusSent, false)}},
		{name: "a paid invoice is past fixing", invs: []Invoice{paid1, paid2},
			want: buyerRefusal{refused(paid1, ReasonPaid), refused(paid2, ReasonPaid)}},
		{name: "an overdue invoice is still open", invs: []Invoice{overdue},
			want: buyerRefusal{refused(overdue, ReasonNpwpMissing)}},
		{name: "an unread client is skipped", invs: []Invoice{{CompanyClientID: 99}}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			want := tc.want
			if want == nil {
				want = buyerRefusal{}
			}
			if got := refusedBuyers(tc.invs, buyers); !reflect.DeepEqual(got, want) {
				t.Fatalf("refusedBuyers = %+v, want %+v", got, want)
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
	row := func(no string, reason RefusalReason) CoretaxRefusal {
		return CoretaxRefusal{InvoiceNo: no, Reason: reason}
	}
	all := buyerRefusal{
		row("INV-4", ReasonPaid), row("INV-1", ReasonNpwpMissing),
		row("INV-3", ReasonTkuMismatch), row("INV-2", ReasonNpwpMissing),
	}
	cases := []struct {
		name string
		in   buyerRefusal
		want string
	}{
		{"none", buyerRefusal{}, ""},
		{"missing", buyerRefusal{row("INV-1", ReasonNpwpMissing), row("INV-2", ReasonNpwpMissing)}, missing},
		{"mismatch", buyerRefusal{row("INV-3", ReasonTkuMismatch)}, mismatch},
		{"paid", buyerRefusal{row("INV-4", ReasonPaid)}, paid},
		{"all three, grouped", all, missing + " " + mismatch + " " + paid},
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

// The refusal carries every row.
func TestBuyerRefusalProblem(t *testing.T) {
	t.Parallel()
	in := buyerRefusal{{InvoiceNo: "INV-1", Reason: ReasonPaid}}
	p := in.problem()
	if p.Status != 422 || p.Code != CoretaxRefusedCode || p.Detail != in.message() || !reflect.DeepEqual(p.Refused, []CoretaxRefusal(in)) {
		t.Fatalf("problem = %+v", p)
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
