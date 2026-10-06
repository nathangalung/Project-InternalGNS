package clients

import (
	"strings"

	"github.com/nathangalung/internalgns/apps/api/internal/shared/validate"
)

// trimText trims in place.
// Handlers call it right after decode, so the value validated is the value
// stored: the SQL BTRIM strips spaces only, not tabs or newlines.
func trimText(p *string) {
	if p != nil {
		*p = strings.TrimSpace(*p)
	}
}

// contactFields checks phone and email.
// The email is already trimmed. An absent phone or a blank email is left
// alone: the first keeps the column empty and the SQL stores the second as
// NULL. A sent phone must pass the digit rule, since
// company_contacts_phone_check refuses a blank one too. It returns nil when
// both pass.
func contactFields(phone, email *string) map[string]string {
	errs := map[string]string{}
	if phone != nil {
		put(errs, "phone", validate.Phone(*phone))
	}
	if email != nil && *email != "" {
		put(errs, "email", validate.Email(*email))
	}
	if len(errs) == 0 {
		return nil
	}
	return errs
}

// put records non-empty messages.
func put(errs map[string]string, field, msg string) {
	if msg != "" {
		errs[field] = msg
	}
}

// MsgContactReach asks for a channel.
// It sits on both email and phone, since either one is enough.
const MsgContactReach = "Isi email atau nomor HP."

// reachable reports a usable channel.
// A blank email counts as none; a sent phone already passed its rule.
func reachable(email, phone *string) bool {
	return (email != nil && *email != "") || phone != nil
}

// needReach builds the 422 fields.
func needReach() map[string]string {
	return map[string]string{"email": MsgContactReach, "phone": MsgContactReach}
}
