package pdfgen

import "strings"

// InternationalPhone prefixes the dial code.
// A contact stores its local number beside its country, so the printed
// number is dialCode, a space, then the number without its trunk 0. A
// number typed with its own + is already international and stays as
// typed, and an empty dialCode leaves the number as it is.
func InternationalPhone(dialCode, phone string) string {
	p := strings.TrimSpace(phone)
	if p == "" || dialCode == "" || strings.HasPrefix(p, "+") {
		return p
	}
	return dialCode + " " + strings.TrimPrefix(p, "0")
}
