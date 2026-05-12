package money

import "github.com/shopspring/decimal"

// Indonesian VAT constants.
//
// Effective 2025: PPN headline rate is 12% but applied to a DPP Nilai Lain
// base of (11/12) × gross. Net effective rate is 11% of the gross subtotal.

// String forms for callers that pipe through string-based big.Float math
// (see internal/pdfgen.BigMul / BigMulDiv).
const (
	DPPNumeratorStr   = "11"
	DPPDenominatorStr = "12"
	PPNRateStr        = "0.12"
)

// Decimal forms for arithmetic in domain code.
var (
	PPNRate  = decimal.NewFromFloat(0.12)
	DPPRatio = decimal.RequireFromString("11").Div(decimal.RequireFromString("12"))
)

// DPPNilaiLain returns subtotal × 11/12.
func DPPNilaiLain(subtotal decimal.Decimal) decimal.Decimal {
	return subtotal.Mul(DPPRatio)
}

// PPNAmount returns dpp × PPNRate.
func PPNAmount(dpp decimal.Decimal) decimal.Decimal {
	return dpp.Mul(PPNRate)
}
