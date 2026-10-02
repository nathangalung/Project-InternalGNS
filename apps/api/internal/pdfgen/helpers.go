package pdfgen

import (
	"fmt"
	"net/http"

	"github.com/shopspring/decimal"
)

// StrDeref dereferences, nil as "".
func StrDeref(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

// SanitizeFilename cleans download filenames.
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

// decFromStr parses a numeric string.
// Empty or malformed input is zero.
func decFromStr(s string) decimal.Decimal {
	d, err := decimal.NewFromString(zero(s))
	if err != nil {
		return decimal.Zero
	}
	return d
}

// decToStr rounds to sen.
// Half away from zero, like Postgres ROUND(numeric, 2), so a printed figure
// matches the one the database stored.
func decToStr(d decimal.Decimal) string {
	return d.Round(2).StringFixed(2)
}

// BigMul multiplies numeric strings.
// The product is exact, then rounded to sen like Postgres. Used for
// monetary qty × price math.
func BigMul(a, b string) string {
	return decToStr(decFromStr(a).Mul(decFromStr(b)))
}

// BigSub subtracts numeric strings.
// It returns a - b.
func BigSub(a, b string) string {
	return decToStr(decFromStr(a).Sub(decFromStr(b)))
}

// BigMulDiv returns a*num/den.
// It returns "0" if den is zero.
func BigMulDiv(a, num, den string) string {
	d := decFromStr(den)
	if d.IsZero() {
		return "0"
	}
	return decToStr(decFromStr(a).Mul(decFromStr(num)).Div(d))
}

// BigAdd adds numeric strings.
func BigAdd(a, b string) string {
	return decToStr(decFromStr(a).Add(decFromStr(b)))
}
