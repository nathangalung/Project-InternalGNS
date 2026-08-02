package pdfgen

import (
	"fmt"
	"math/big"
	"net/http"
)

// StrDeref returns *p or "" if p is nil.
func StrDeref(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

// SanitizeFilename strips characters unsafe for Content-Disposition filenames.
// Allowed: ASCII alphanumerics, '-', '_', '.'. Anything else becomes '_'.
// Empty result falls back to "document".
func SanitizeFilename(s string) string {
	out := make([]rune, 0, len(s))
	for _, r := range s {
		switch {
		case r >= 'a' && r <= 'z',
			r >= 'A' && r <= 'Z',
			r >= '0' && r <= '9',
			r == '-' || r == '_' || r == '.':
			out = append(out, r)
		default:
			out = append(out, '_')
		}
	}
	if len(out) == 0 {
		return "document"
	}
	return string(out)
}

// WritePDFResponse sets pdf headers (Content-Type, Content-Disposition with
// sanitized filename) and writes pdfBytes. Returns any io error from Write.
func WritePDFResponse(w http.ResponseWriter, nameBase string, pdfBytes []byte) error {
	w.Header().Set("Content-Type", "application/pdf")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s.pdf"`, SanitizeFilename(nameBase)))
	_, err := w.Write(pdfBytes)
	return err
}

// zero turns "" into "0", passing other strings through.
func zero(s string) string {
	if s == "" {
		return "0"
	}
	return s
}

func bigFromStr(s string) *big.Float {
	x, _ := new(big.Float).SetPrec(64).SetString(zero(s))
	if x == nil {
		return new(big.Float)
	}
	return x
}

func bigToStr(f *big.Float) string {
	return f.Text('f', 2)
}

// BigMul multiplies two numeric strings using big.Float (64-bit precision),
// returning a 2-decimal string. Used for monetary qty × price math.
func BigMul(a, b string) string {
	return bigToStr(new(big.Float).Mul(bigFromStr(a), bigFromStr(b)))
}

// BigSub subtracts b from a on numeric strings.
func BigSub(a, b string) string {
	return bigToStr(new(big.Float).Sub(bigFromStr(a), bigFromStr(b)))
}

// BigMulDiv returns a * num / den. Returns "0" if den is zero.
func BigMulDiv(a, num, den string) string {
	prod := new(big.Float).Mul(bigFromStr(a), bigFromStr(num))
	d := bigFromStr(den)
	if d.Sign() == 0 {
		return "0"
	}
	return bigToStr(new(big.Float).Quo(prod, d))
}

// BigAdd adds two numeric strings using big.Float.
func BigAdd(a, b string) string {
	return bigToStr(new(big.Float).Add(bigFromStr(a), bigFromStr(b)))
}
