package purchaseorders

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func s(v string) *string { return &v }

func TestMissingClientFields(t *testing.T) {
	complete := ClientCompleteness{
		ID: 1, Name: "PT. IMC Ship Management",
		Number: s("2641"), Npwp: s("0612345678901000"), Address: s("Jakarta Selatan"),
		ContactName: s("Bp. Restu"), ContactEmail: s("restu@imc.example"),
	}

	cases := []struct {
		name  string
		input ClientCompleteness
		want  []string
	}{
		{name: "complete", input: complete},
		{
			name:  "blank strings count as missing",
			input: ClientCompleteness{ID: 1, Name: "X", Number: s("  "), Npwp: s(""), Address: nil, ContactName: s("A"), ContactPhone: s("08")},
			want:  []string{"Nomor Klien", "NPWP", "Alamat"},
		},
		{
			name:  "phone alone satisfies the contact channel",
			input: ClientCompleteness{ID: 1, Name: "X", Number: s("1"), Npwp: s("2"), Address: s("3"), ContactName: s("A"), ContactPhone: s("08")},
		},
		{
			name:  "no contact at all",
			input: ClientCompleteness{ID: 1, Name: "X", Number: s("1"), Npwp: s("2"), Address: s("3")},
			want:  []string{"Nama Narahubung", "Email atau Nomor Telepon Narahubung"},
		},
		{
			// A deactivated contact cannot be edited, so its own fields are
			// moot: the quotation has to pick an active one.
			name: "chosen contact deactivated",
			input: ClientCompleteness{
				ID: 1, Name: "X", Number: s("1"), Npwp: s("2"),
				ContactName: s("A"), ContactEmail: s("a@b.c"), ContactInactive: true,
			},
			want: []string{"Alamat", "Narahubung aktif"},
		},
		{
			// TKU is derived from the NPWP when it is not recorded, the same
			// fallback the Coretax export uses, so it is not required here.
			name:  "missing TKU is not an issue",
			input: complete,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.want, missingClientFields(tc.input))
		})
	}
}

func TestMissingVendorFields(t *testing.T) {
	cases := []struct {
		name  string
		input VendorCompleteness
		want  []string
	}{
		{
			name:  "complete",
			input: VendorCompleteness{ID: 1, Name: "Toko ABC", Location: s("Jakarta"), ContactEmail: s("a@b.c")},
		},
		{
			name:  "whatsapp only is not a channel",
			input: VendorCompleteness{ID: 2, Name: "CV Marine", Location: s("Surabaya")},
			want:  []string{"Email atau Nomor Telepon"},
		},
		{
			name:  "nothing filled",
			input: VendorCompleteness{ID: 3, Name: "PT X"},
			want:  []string{"Lokasi", "Email atau Nomor Telepon"},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.want, missingVendorFields(tc.input))
		})
	}
}

func TestCompletenessFields(t *testing.T) {
	issues := []CompletenessIssue{
		{Scope: "klien", ID: 7, Name: "PT X", Missing: []string{"NPWP", "Alamat"}},
		{Scope: "vendor", ID: 3, Name: "CV Y", Missing: []string{"Lokasi"}},
		{Scope: "pengiriman", ID: 41, Missing: []string{"Alamat Pengiriman"}},
	}
	assert.Equal(t, map[string]string{
		"klien:7":       "Data klien PT X belum lengkap: NPWP, Alamat",
		"vendor:3":      "Data vendor CV Y belum lengkap: Lokasi",
		"pengiriman:41": "Alamat pengiriman belum diisi",
	}, completenessFields(issues))
}

// One gap for the PO's address.
func TestShippingIssues(t *testing.T) {
	product := func(dest *string) LineCompleteness {
		return LineCompleteness{ItemType: "product", ShipDestination: dest}
	}
	shipping := func(dest *string) LineCompleteness {
		return LineCompleteness{ItemType: "shipping", ShipDestination: dest}
	}
	gap := []CompletenessIssue{{Scope: "pengiriman", ID: 9, Missing: []string{"Alamat Pengiriman"}}}

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
