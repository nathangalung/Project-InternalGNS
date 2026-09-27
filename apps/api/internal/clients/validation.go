package clients

import (
	"strings"

	"github.com/nathangalung/internalgns/apps/api/internal/shared/validate"
)

// contactFields checks phone and email.
// An absent phone or a blank email is left alone: the first keeps the
// column empty and the SQL stores the second as NULL. A sent phone must pass
// the digit rule, since company_contacts_phone_check refuses a blank one
// too. It returns nil when both pass.
func contactFields(phone, email *string) map[string]string {
	errs := map[string]string{}
	if phone != nil {
		put(errs, "phone", validate.Phone(*phone))
	}
	if email != nil {
		if e := strings.TrimSpace(*email); e != "" {
			put(errs, "email", validate.Email(e))
		}
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
