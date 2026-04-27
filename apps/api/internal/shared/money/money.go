package money

import (
	"fmt"

	"github.com/shopspring/decimal"
)

// Format decimal as Rupiah.
func Rupiah(d decimal.Decimal) string {
	return "Rp " + thousandsID(d.StringFixed(2))
}

// Indonesian thousands separator.
func thousandsID(s string) string {
	sign := ""
	if len(s) > 0 && s[0] == '-' {
		sign = "-"
		s = s[1:]
	}
	intPart, fracPart := s, ""
	for i := 0; i < len(s); i++ {
		if s[i] == '.' {
			intPart = s[:i]
			fracPart = s[i+1:]
			break
		}
	}
	// Dot every three digits.
	n := len(intPart)
	if n <= 3 {
		if fracPart == "" {
			return sign + intPart
		}
		return sign + intPart + "," + fracPart
	}
	head := n % 3
	out := make([]byte, 0, n+n/3+2+len(fracPart))
	if head > 0 {
		out = append(out, intPart[:head]...)
		if n > head {
			out = append(out, '.')
		}
	}
	for i := head; i < n; i += 3 {
		out = append(out, intPart[i:i+3]...)
		if i+3 < n {
			out = append(out, '.')
		}
	}
	if fracPart != "" {
		out = append(out, ',')
		out = append(out, fracPart...)
	}
	return sign + string(out)
}

// Parse decimal or panic.
func MustParse(s string) decimal.Decimal {
	d, err := decimal.NewFromString(s)
	if err != nil {
		panic(fmt.Sprintf("money.MustParse(%q): %v", s, err))
	}
	return d
}
