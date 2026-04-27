package money

import (
	"testing"

	"github.com/shopspring/decimal"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestRupiah(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want string
	}{
		{"zero", "0", "Rp 0,00"},
		{"hundreds", "999", "Rp 999,00"},
		{"thousands", "1000", "Rp 1.000,00"},
		{"ten thousands", "12345", "Rp 12.345,00"},
		{"millions", "1234567", "Rp 1.234.567,00"},
		{"billions", "1234567890", "Rp 1.234.567.890,00"},
		{"with cents", "1234.56", "Rp 1.234,56"},
		{"negative", "-1234.56", "Rp -1.234,56"},
		{"three digits exact", "100", "Rp 100,00"},
		{"four digits", "1500", "Rp 1.500,00"},
		{"large with cents", "9876543.21", "Rp 9.876.543,21"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			d, err := decimal.NewFromString(tc.in)
			require.NoError(t, err)
			assert.Equal(t, tc.want, Rupiah(d))
		})
	}
}

func TestMustParse(t *testing.T) {
	t.Run("valid", func(t *testing.T) {
		d := MustParse("123.45")
		assert.Equal(t, "123.45", d.String())
	})
	t.Run("panic on invalid", func(t *testing.T) {
		assert.Panics(t, func() { MustParse("not-a-number") })
	})
}

func TestThousandsID_EdgeCases(t *testing.T) {
	cases := []struct{ in, want string }{
		{"", ""},
		{"1", "1"},
		{"12", "12"},
		{"123", "123"},
		{"1234", "1.234"},
		{"-99", "-99"},
		{"-1234", "-1.234"},
		{"-1.5", "-1,5"},
		{"100.05", "100,05"},
	}
	for _, tc := range cases {
		assert.Equal(t, tc.want, thousandsID(tc.in))
	}
}
