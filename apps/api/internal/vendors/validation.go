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

// requestFields checks a vendor body.
// It runs contactInfoFields and storeURLField and joins their messages. It
// returns nil when every field passes.
func requestFields(ci *ContactInfo, storeURL **string) map[string]string {
	errs := contactInfoFields(ci)
	if msg := storeURLField(storeURL); msg != "" {
		if errs == nil {
			errs = map[string]string{}
		}
		errs["storeUrl"] = msg
	}
	return errs
}

// storeURLField checks the store link.
// It trims the link in place and drops a blank one, so the link checked is
// the link stored. It returns "" when the link passes.
func storeURLField(u **string) string {
	if *u == nil {
		return ""
	}
	trimmed := strings.TrimSpace(**u)
	if trimmed == "" {
		*u = nil
		return ""
	}
	*u = &trimmed
	return validate.StoreURL(trimmed)
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
