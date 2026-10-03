package validate_test

import (
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/nathangalung/internalgns/apps/api/internal/shared/validate"
)

// Decimal inputs refuse NaN.
// strconv.ParseFloat takes "NaN" and "Inf" without error, and Postgres sorts
// NaN above every number, so a plain >= 0 check passes both.
func TestNonNegativeAndPositive(t *testing.T) {
	cases := []struct {
		in          string
		nonNegative bool
		positive    bool
	}{
		{"0", true, false},
		{"0.00", true, false},
		{"-0", true, false},
		{"1", true, true},
		{" 1500000.50 ", true, true},
		{"1e3", true, true},
		{"-1", false, false},
		{"-0.01", false, false},
		// Stored to the sen: 0.004 is 0.00, 0.005 rounds up to 0.01.
		{"0.004", true, false},
		{"0.005", true, true},
		{"NaN", false, false},
		{"nan", false, false},
		{"Inf", false, false},
		{"+Infinity", false, false},
		{"-Inf", false, false},
		{"1e400", false, false},
		{"", false, false},
		{"   ", false, false},
		{"satu", false, false},
		{"1,5", false, false},
	}
	for _, c := range cases {
		t.Run(c.in, func(t *testing.T) {
			wantNonNeg, wantPos := "", ""
			if !c.nonNegative {
				wantNonNeg = "Harga jual harus berupa angka 0 atau lebih."
			}
			if !c.positive {
				wantPos = "Jumlah harus berupa angka lebih dari 0."
			}
			assert.Equal(t, wantNonNeg, validate.NonNegative("Harga jual", c.in))
			assert.Equal(t, wantPos, validate.Positive("Jumlah", c.in))
		})
	}
}

// Day counts stay within bounds.
func TestDays(t *testing.T) {
	msg := "Masa berlaku harus antara 1 dan 365 hari."
	cases := []struct {
		n    int
		want string
	}{
		{1, ""},
		{30, ""},
		{validate.MaxDays, ""},
		{validate.MaxDays + 1, msg},
		{0, msg},
		{-30, msg},
	}
	for _, c := range cases {
		assert.Equal(t, c.want, validate.Days("Masa berlaku", c.n), "n=%d", c.n)
	}
}

// Fields keeps only failures.
func TestFields(t *testing.T) {
	f := validate.Fields{}
	f.Add("qty", "")
	assert.Nil(t, f.Result())
	f.Add("qty", validate.Positive("Jumlah", "NaN"))
	assert.Equal(t, map[string]string{"qty": "Jumlah harus berupa angka lebih dari 0."}, f.Result())
}
