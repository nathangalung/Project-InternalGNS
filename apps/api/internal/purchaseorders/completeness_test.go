package purchaseorders

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func s(v string) *string { return &v }

// codes lists gap codes.
func codes(gaps []CompletenessGap) []GapCode {
	out := make([]GapCode, 0, len(gaps))
	for _, g := range gaps {
		out = append(out, g.Code)
	}
	return out
}

// validNPWP is a 16-digit NPWP.
const validNPWP = "0612345678901000"

func TestMissingClientFields(t *testing.T) {
	complete := ClientCompleteness{
		ID: 1, Name: "PT. IMC Ship Management",
		Number: s("2641"), Npwp: s("0612345678901000"), Address: s("Jakarta Selatan"),
		ContactName: s("Bp. Restu"), ContactEmail: s("restu@imc.example"),
	}

	cases := []struct {
		name  string
		input ClientCompleteness
		want  []GapCode
	}{
		{name: "complete", input: complete, want: []GapCode{}},
		{
			name:  "blank strings count as missing",
			input: ClientCompleteness{ID: 1, Name: "X", Number: s("  "), Npwp: s(""), Address: nil, ContactName: s("A"), ContactPhone: s("08")},
			want:  []GapCode{GapClientNumber, GapClientNpwp, GapClientAddress},
		},
		{
			name:  "phone alone satisfies the contact channel",
			input: ClientCompleteness{ID: 1, Name: "X", Number: s("1"), Npwp: s(validNPWP), Address: s("3"), ContactName: s("A"), ContactPhone: s("08")},
			want:  []GapCode{},
		},
		{
			name:  "no contact at all",
			input: ClientCompleteness{ID: 1, Name: "X", Number: s("1"), Npwp: s(validNPWP), Address: s("3")},
			want:  []GapCode{GapContactName, GapContactReach},
		},
		{
			// A deactivated contact cannot be edited, so its own fields are
			// moot: the quotation has to pick an active one.
			name: "chosen contact deactivated",
			input: ClientCompleteness{
				ID: 1, Name: "X", Number: s("1"), Npwp: s(validNPWP),
				ContactName: s("A"), ContactEmail: s("a@b.c"), ContactInactive: true,
			},
			want: []GapCode{GapClientAddress, GapContactInactive},
		},
		{
			// Coretax refuses the invoice issued at DELIVERED.
			name:  "indonesian NPWP short of 16 digits",
			input: ClientCompleteness{ID: 1, Name: "X", Number: s("1"), Npwp: s("012345678901000"), Address: s("3"), ContactName: s("A"), ContactPhone: s("08")},
			want:  []GapCode{GapClientNpwp},
		},
		{
			name:  "foreign buyer keeps its own tax id",
			input: ClientCompleteness{ID: 1, Name: "X", Number: s("1"), Npwp: s("T08LL1234A"), CountryCode: "SGP", Address: s("3"), ContactName: s("A"), ContactPhone: s("08")},
			want:  []GapCode{},
		},
		{
			// TKU is derived from the NPWP when it is not recorded, the same
			// fallback the Coretax export uses, so it is not required here.
			name:  "missing TKU is not an issue",
			input: complete,
			want:  []GapCode{},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.want, codes(missingClientFields(tc.input)))
		})
	}
}

func TestMissingVendorFields(t *testing.T) {
	cases := []struct {
		name  string
		input VendorCompleteness
		want  []GapCode
	}{
		{
			name:  "complete",
			input: VendorCompleteness{ID: 1, Name: "Toko ABC", Location: s("Jakarta"), ContactEmail: s("a@b.c")},
			want:  []GapCode{},
		},
		{
			name:  "whatsapp only is not a channel",
			input: VendorCompleteness{ID: 2, Name: "CV Marine", Location: s("Surabaya")},
			want:  []GapCode{GapVendorReach},
		},
		{
			name:  "nothing filled",
			input: VendorCompleteness{ID: 3, Name: "PT X"},
			want:  []GapCode{GapVendorLocation, GapVendorReach},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.want, codes(missingVendorFields(tc.input)))
		})
	}
}

// Every code has its label.
func TestGapLabels(t *testing.T) {
	assert.Equal(t, []CompletenessGap{
		{Code: GapClientNumber, Label: "Nomor Klien"},
		{Code: GapClientNpwp, Label: "NPWP"},
		{Code: GapClientAddress, Label: "Alamat"},
		{Code: GapContactName, Label: "Nama Narahubung"},
		{Code: GapContactReach, Label: "Email atau Nomor Telepon Narahubung"},
	}, missingClientFields(ClientCompleteness{}))
	assert.Equal(t, []CompletenessGap{{Code: GapContactInactive, Label: "Narahubung aktif"}},
		missingClientFields(ClientCompleteness{
			Number: s("1"), Npwp: s(validNPWP), Address: s("3"), ContactInactive: true,
		}))
	assert.Equal(t, []CompletenessGap{
		{Code: GapVendorLocation, Label: "Lokasi"},
		{Code: GapVendorReach, Label: "Email atau Nomor Telepon"},
	}, missingVendorFields(VendorCompleteness{}))
}

func TestRecordIssue(t *testing.T) {
	gaps := []CompletenessGap{{Code: GapClientNpwp, Label: "NPWP"}, {Code: GapClientAddress, Label: "Alamat"}}
	assert.Equal(t, CompletenessIssue{
		Kind: KindClient, ID: 7, Name: "PT X", Missing: gaps,
		Message: "Data klien PT X belum lengkap: NPWP, Alamat",
	}, recordIssue(KindClient, 7, "PT X", gaps))
	assert.Equal(t, "Data vendor CV Y belum lengkap: Lokasi",
		recordIssue(KindVendor, 3, "CV Y", []CompletenessGap{{Code: GapVendorLocation, Label: "Lokasi"}}).Message)
}

func TestCompletenessFields(t *testing.T) {
	issues := []CompletenessIssue{
		recordIssue(KindClient, 7, "PT X", []CompletenessGap{{Code: GapClientNpwp, Label: "NPWP"}}),
		recordIssue(KindVendor, 3, "CV Y", []CompletenessGap{{Code: GapVendorLocation, Label: "Lokasi"}}),
		shippingIssues(41, []LineCompleteness{{ItemType: "product"}})[0],
	}
	assert.Equal(t, map[string]string{
		"klien:7":       "Data klien PT X belum lengkap: NPWP",
		"vendor:3":      "Data vendor CV Y belum lengkap: Lokasi",
		"pengiriman:41": "Alamat pengiriman belum diisi",
	}, completenessFields(issues))
}

// The gate's typed 422.
func TestIncompleteProblem(t *testing.T) {
	issues := []CompletenessIssue{
		recordIssue(KindClient, 7, "PT X", []CompletenessGap{{Code: GapClientNpwp, Label: "NPWP"}}),
	}
	p := incompleteProblem(issues)
	assert.Equal(t, 422, p.Status)
	assert.Equal(t, IncompleteCode, p.Code)
	assert.Equal(t, "Data klien PT X belum lengkap: NPWP", p.Detail)
	assert.Equal(t, map[string]string{"klien:7": "Data klien PT X belum lengkap: NPWP"}, p.Fields)
	assert.Equal(t, issues, p.Issues)
}

// One gap for the PO's address.
func TestPoNumberIssues(t *testing.T) {
	gap := []CompletenessIssue{{
		Kind: KindPurchaseOrder, ID: 9, Message: "No. PO klien belum diisi",
		Missing: []CompletenessGap{{Code: GapPoNumber, Label: "No. PO Klien"}},
	}}
	cases := []struct {
		name   string
		number *string
		want   []CompletenessIssue
	}{
		{name: "entered", number: s("PO/KLIEN/1")},
		{name: "none", want: gap},
		{name: "blank", number: s("  "), want: gap},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.want, poNumberIssues(9, tc.number))
		})
	}
	assert.Equal(t, map[string]string{"po:9": "No. PO klien belum diisi"}, completenessFields(gap))
}

func TestShippingIssues(t *testing.T) {
	product := func(dest *string) LineCompleteness {
		return LineCompleteness{ItemType: "product", ShipDestination: dest}
	}
	shipping := func(dest *string) LineCompleteness {
		return LineCompleteness{ItemType: "shipping", ShipDestination: dest}
	}
	gap := []CompletenessIssue{{
		Kind: KindShipping, ID: 9, Message: "Alamat pengiriman belum diisi",
		Missing: []CompletenessGap{{Code: GapShippingAddress, Label: "Alamat Pengiriman"}},
	}}

	cases := []struct {
		name  string
		input []LineCompleteness
		want  []CompletenessIssue
	}{
		{name: "no lines"},
		{name: "products carry their own", input: []LineCompleteness{product(s("Kapal A")), product(s("Kapal B"))}},
		{name: "shipping line covers the products", input: []LineCompleteness{product(nil), shipping(s("Kapal A"))}},
		{name: "no shipping line and a blank product", input: []LineCompleteness{product(s("Kapal A")), product(s("  "))}, want: gap},
		{name: "blank shipping line and a blank product", input: []LineCompleteness{product(nil), shipping(s(" "))}, want: gap},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.want, shippingIssues(9, tc.input))
		})
	}
}
