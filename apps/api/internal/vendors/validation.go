package vendors

import (
	"strings"

	"github.com/nathangalung/internalgns/apps/api/internal/shared/validate"
)

// trimContactEmail trims in place.
// Handlers call it right after decode, so the address validated is the
// address stored.
func trimContactEmail(ci *ContactInfo) {
	if ci != nil {
		ci.Email = strings.TrimSpace(ci.Email)
	}
}

// contactInfoFields checks email and phone.
// Keys are the request paths, so the web can mark the input. A blank field
// is absent and passes. It returns nil when both pass.
func contactInfoFields(ci *ContactInfo) map[string]string {
	if ci == nil {
		return nil
	}
	errs := map[string]string{}
	if ci.Phone != "" {
		if msg := validate.Phone(ci.Phone); msg != "" {
			errs["contactInfo.phone"] = msg
		}
	}
	if ci.Email != "" {
		if msg := validate.Email(ci.Email); msg != "" {
			errs["contactInfo.email"] = msg
		}
	}
	if len(errs) == 0 {
		return nil
	}
	return errs
}
