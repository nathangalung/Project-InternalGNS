package money

import (
	"testing"

	"github.com/shopspring/decimal"
	"github.com/stretchr/testify/assert"
)

func TestPPNConstants(t *testing.T) {
	assert.Equal(t, "11", DPPNumeratorStr)
	assert.Equal(t, "12", DPPDenominatorStr)
	assert.Equal(t, "0.12", PPNRateStr)
	assert.True(t, PPNRate.Equal(decimal.NewFromFloat(0.12)))
}

func TestDPPNilaiLain(t *testing.T) {
	subtotal := decimal.NewFromInt(1200)
	got := DPPNilaiLain(subtotal)
	// 1200 * 11/12 = 1100
	assert.Equal(t, "1100", got.StringFixed(0))
}

func TestPPNAmount(t *testing.T) {
	dpp := decimal.NewFromInt(1100)
	got := PPNAmount(dpp)
	// 1100 * 0.12 = 132
	assert.Equal(t, "132", got.StringFixed(0))
}

func TestEffectiveRate(t *testing.T) {
	// Net effective rate ≈ 11% of gross subtotal.
	subtotal := decimal.NewFromInt(12000)
	dpp := DPPNilaiLain(subtotal)
	ppn := PPNAmount(dpp)
	// 12000 * 11/12 * 0.12 = 1320 = 11% * 12000
	assert.Equal(t, "1320", ppn.StringFixed(0))
}
