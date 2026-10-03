package validate_test

import (
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/nathangalung/internalgns/apps/api/internal/shared/validate"
)

// NPWP digits Coretax accepts.
func TestNPWP(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want string
		ok   bool
	}{
		{"plain 16 digits", "0123456789012345", "0123456789012345", true},
		{"printed separators", "01.234.567.89.012.345", "0123456789012345", true},
		{"spaces", " 0123456789012345 ", "0123456789012345", true},
		{"legacy 15 digits", "01.234.567.8-901.000", "012345678901000", false},
		{"too long", "01234567890123456", "01234567890123456", false},
		{"letters", "PASSPORT123", "", false},
		{"empty", "", "", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, ok := validate.NPWP(tc.in)
			assert.Equal(t, tc.want, got)
			assert.Equal(t, tc.ok, ok)
		})
	}
}

// Blank country reads as Indonesia.
func TestIndonesian(t *testing.T) {
	assert.True(t, validate.Indonesian(""))
	assert.True(t, validate.Indonesian("idn"))
	assert.False(t, validate.Indonesian("SGP"))
}

// Input rule for a client NPWP.
// Blank stays allowed, a foreign buyer keeps its own tax id, and an
// Indonesian one must be the 16 digits Coretax files.
func TestClientNPWP(t *testing.T) {
	msg := "NPWP harus 16 digit angka."
	s := func(v string) *string { return &v }
	cases := []struct {
		name    string
		country string
		npwp    *string
		want    string
	}{
		{"none", "IDN", nil, ""},
		{"blank", "IDN", s("  "), ""},
		{"valid", "IDN", s("01.234.567.89.012.345"), ""},
		{"blank country is Indonesia", "", s("12345"), msg},
		{"legacy 15 digits", "IDN", s("012345678901000"), msg},
		{"foreign tax id", "SGP", s("T08LL1234A"), ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.want, validate.ClientNPWP(tc.country, tc.npwp))
		})
	}
}

// Indonesian NPWP is stored as digits.
func TestStoredNPWP(t *testing.T) {
	s := func(v string) *string { return &v }
	assert.Nil(t, validate.StoredNPWP("IDN", nil))
	assert.Equal(t, "0123456789012345", *validate.StoredNPWP("IDN", s("01.234.567.89.012.345")))
	assert.Equal(t, "T08LL1234A", *validate.StoredNPWP("SGP", s("T08LL1234A")))
	assert.Equal(t, "  ", *validate.StoredNPWP("IDN", s("  ")), "blank is left to the repo")
}
