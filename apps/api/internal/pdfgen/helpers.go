package pdfgen

import (
	"fmt"
	"math/big"
	"net/http"
)

// StrDeref dereferences, nil as "".
func StrDeref(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

// SanitizeFilename makes Content-Disposition-safe names.
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

// WritePDFResponse writes a PDF response.
// It sets the headers (Content-Type, Content-Disposition with a sanitized
// filename) and writes pdfBytes. Returns any io error from Write.
func WritePDFResponse(w http.ResponseWriter, nameBase string, pdfBytes []byte) error {
	w.Header().Set("Content-Type", "application/pdf")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s.pdf"`, SanitizeFilename(nameBase)))
	_, err := w.Write(pdfBytes)
	return err
}

// zero maps "" to "0".
// Other strings pass through.
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

// BigMul multiplies numeric strings.
// It uses big.Float (64-bit precision) and returns a 2-decimal string. Used
// for monetary qty × price math.
func BigMul(a, b string) string {
	return bigToStr(new(big.Float).Mul(bigFromStr(a), bigFromStr(b)))
}

// BigSub subtracts numeric strings.
// It returns a - b.
func BigSub(a, b string) string {
	return bigToStr(new(big.Float).Sub(bigFromStr(a), bigFromStr(b)))
}

// BigMulDiv returns a*num/den.
// It returns "0" if den is zero.
func BigMulDiv(a, num, den string) string {
	prod := new(big.Float).Mul(bigFromStr(a), bigFromStr(num))
	d := bigFromStr(den)
	if d.Sign() == 0 {
		return "0"
	}
	return bigToStr(new(big.Float).Quo(prod, d))
}

// BigAdd adds numeric strings.
// It uses big.Float.
func BigAdd(a, b string) string {
	return bigToStr(new(big.Float).Add(bigFromStr(a), bigFromStr(b)))
}
