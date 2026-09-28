// Package validate checks contact fields.
//
// It is the source of truth for phone and email. apps/web/src/lib/validation.ts
// mirrors it, and testdata/contact_rules.json pins both to the same cases.
package validate

import "regexp"

// Field messages, shown inline.
const (
	PhoneMessage = "Nomor telepon harus 9–12 digit angka."
	EmailMessage = "Format email tidak valid."
)

// Phone digit bounds.
// They match company_contacts_phone_check (migration 00011).
const (
	phoneMinDigits = 9
	phoneMaxDigits = 12
)

// emailPattern is one plain mailbox.
// An RFC 5322 dot-atom local part of ASCII atext, then host labels that
// start and end with a letter or digit, and a top-level label of two letters
// or more. It is stricter than net/mail, which also takes dotless domains,
// domain literals and non-ASCII text. The web copy uses the same pattern.
var emailPattern = regexp.MustCompile(
	"^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(\\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*" +
		"@([A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?\\.)+[A-Za-z]{2,}$",
)

// Phone checks the digit count.
// Only ASCII digits count, so separators and a leading + are ignored, as
// in the database CHECK. It returns "" when s passes.
func Phone(s string) string {
	n := 0
	for i := 0; i < len(s); i++ {
		if s[i] >= '0' && s[i] <= '9' {
			n++
		}
	}
	if n < phoneMinDigits || n > phoneMaxDigits {
		return PhoneMessage
	}
	return ""
}

// Email checks one plain mailbox.
// s is checked as given; callers trim first. It returns "" when s passes.
func Email(s string) string {
	if !emailPattern.MatchString(s) {
		return EmailMessage
	}
	return ""
}
