package validate

import (
	"regexp"
	"strings"
)

// IMPAMessage sits on an IMPA code.
const IMPAMessage = "Kode IMPA harus 6 digit angka, misalnya 190105. Kosongkan bila tidak ada."

// IMPA code patterns.
// impaNone is a blank or the shown "-" placeholder; impaMark is the IMPA
// word a client writes before the code; impaBody is six digits, optionally
// grouped by spaces, dots or hyphens as catalogs print them (19 01 05).
var (
	impaNone = regexp.MustCompile(`^[-\x{2013}\x{2014}]*$`)
	impaMark = regexp.MustCompile(`^IMPA\s*[:.#]?\s*`)
	impaBody = regexp.MustCompile(`^[0-9][0-9 .-]*[0-9]$`)
)

// IMPA normalises an IMPA code.
// It returns the six digits a typed form reduces to, "" for no code, or
// IMPAMessage. fn_impa_code is the database copy and
// testdata/impa_rules.json pins both, the web and the import tool.
func IMPA(raw string) (code, msg string) {
	t := strings.TrimSpace(raw)
	if impaNone.MatchString(t) {
		return "", ""
	}
	u := strings.ToUpper(t)
	if strings.HasPrefix(u, "(") && strings.HasSuffix(u, ")") {
		u = strings.TrimSpace(u[1 : len(u)-1])
	}
	u = impaMark.ReplaceAllString(u, "")
	if impaBody.MatchString(u) {
		digits := strings.Map(func(r rune) rune {
			if r >= '0' && r <= '9' {
				return r
			}
			return -1
		}, u)
		if len(digits) == 6 {
			return digits, ""
		}
	}
	return "", IMPAMessage
}

// OptionalIMPA normalises a field.
// A valid code is rewritten to its six digits and no code to nil. A bad
// one is left as typed and its message returned.
func OptionalIMPA(p **string) string {
	if *p == nil {
		return ""
	}
	code, msg := IMPA(**p)
	switch {
	case msg != "":
		return msg
	case code == "":
		*p = nil
	default:
		*p = &code
	}
	return ""
}
