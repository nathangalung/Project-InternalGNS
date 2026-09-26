package quotations

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestValidateDiscountPct(t *testing.T) {
	cases := []struct {
		raw string
		ok  bool
	}{
		{"0", true},
		{"7.5", true},
		{" 100 ", true},
		{"100.00", true},
		{"", false},
		{"abc", false},
		{"-0.01", false},
		{"100.01", false},
		{"150", false},
		{"NaN", false},
		{"Inf", false},
		{"-Inf", false},
	}
	for _, c := range cases {
		t.Run(c.raw, func(t *testing.T) {
			got := validateDiscountPct(c.raw)
			if c.ok {
				assert.Nil(t, got)
				return
			}
			assert.Equal(t, "Diskon harus berupa angka antara 0 dan 100.", got["discountPct"])
		})
	}
}
