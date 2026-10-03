package validate

import "strings"

// NPWPDigits is Coretax's NPWP length.
const NPWPDigits = 16

// NPWP strips NPWP separators.
// It returns the digits and whether they make a full-length NPWP; any
// character other than a digit, dot, dash or space fails.
func NPWP(raw string) (string, bool) {
	var b strings.Builder
	for _, r := range strings.TrimSpace(raw) {
		switch {
		case r >= '0' && r <= '9':
			b.WriteRune(r)
		case r == '.' || r == '-' || r == ' ':
		default:
			return "", false
		}
	}
	out := b.String()
	return out, len(out) == NPWPDigits
}

// Indonesian reads blank as IDN.
// That matches the client default and the Coretax XML default.
func Indonesian(countryCode string) bool {
	return countryCode == "" || strings.EqualFold(countryCode, "IDN")
}

// ClientNPWP checks a client's NPWP.
// Blank is allowed; an Indonesian client's NPWP must be the 16 digits
// Coretax files, while a foreign buyer keeps its own tax id. It returns ""
// when npwp passes.
func ClientNPWP(countryCode string, npwp *string) string {
	if npwp == nil || strings.TrimSpace(*npwp) == "" || !Indonesian(countryCode) {
		return ""
	}
	if _, ok := NPWP(*npwp); ok {
		return ""
	}
	return "NPWP harus 16 digit angka."
}

// StoredNPWP is the NPWP to save.
// An Indonesian NPWP keeps only its digits: the printed form runs past the
// 20-character column, and Coretax reads digits anyway. Anything else is
// returned as given.
func StoredNPWP(countryCode string, npwp *string) *string {
	if npwp == nil || !Indonesian(countryCode) {
		return npwp
	}
	if digits, ok := NPWP(*npwp); ok {
		return &digits
	}
	return npwp
}
