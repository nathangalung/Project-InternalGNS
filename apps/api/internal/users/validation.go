package users

import (
	"fmt"
	"strings"
	"unicode"

	"github.com/nathangalung/internalgns/apps/api/internal/shared/validate"
)

// Password length bounds.
// The maximum is bcrypt's own input limit: anything longer made the hash
// call fail and surfaced as a 500.
const (
	passwordMinRunes = 8
	passwordMaxBytes = 72
)

// ValidatePassword returns the policy message.
// It is "" when pw passes.
// Mirrors apps/web/src/features/users/password.ts so the form and the server
// accept exactly the same passwords.
func ValidatePassword(pw string) string {
	var missing []string
	if len([]rune(pw)) < passwordMinRunes {
		missing = append(missing, fmt.Sprintf("minimal %d karakter", passwordMinRunes))
	}
	if len(pw) > passwordMaxBytes {
		return fmt.Sprintf("Kata sandi terlalu panjang, maksimal %d karakter.", passwordMaxBytes)
	}
	var hasUpper, hasDigit, hasSymbol bool
	for _, r := range pw {
		switch {
		case unicode.IsUpper(r):
			hasUpper = true
		case unicode.IsDigit(r):
			hasDigit = true
		case !unicode.IsLetter(r):
			hasSymbol = true
		}
	}
	if !hasUpper {
		missing = append(missing, "1 huruf kapital")
	}
	if !hasDigit {
		missing = append(missing, "1 angka")
	}
	if !hasSymbol {
		missing = append(missing, "1 simbol")
	}
	if len(missing) == 0 {
		return ""
	}
	return "Kata sandi harus memuat " + strings.Join(missing, ", ") + "."
}

// validateEmail requires one mailbox.
// The format rule is shared/validate, the one clients, contacts, vendors
// and the web forms use.
func validateEmail(email string) string {
	trimmed := strings.TrimSpace(email)
	if trimmed == "" {
		return "Email wajib diisi."
	}
	return validate.Email(trimmed)
}

// validateName rejects whitespace-only names.
func validateName(name string) string {
	if strings.TrimSpace(name) == "" {
		return "Nama wajib diisi."
	}
	return ""
}

// validateRole checks the role enum.
func validateRole(r Role) string {
	switch r {
	case RoleSuperadmin, RoleOperational, RoleFinance:
		return ""
	}
	return "Peran tidak valid."
}

// put records non-empty messages.
func put(errs map[string]string, field, msg string) {
	if msg != "" {
		errs[field] = msg
	}
}

// validateCreate enforces the create payload.
func validateCreate(req CreateUserRequest) map[string]string {
	errs := map[string]string{}
	put(errs, "email", validateEmail(req.Email))
	put(errs, "name", validateName(req.Name))
	put(errs, "password", ValidatePassword(req.Password))
	put(errs, "role", validateRole(req.Role))
	if len(errs) == 0 {
		return nil
	}
	return errs
}

// validateUpdate enforces the update payload.
// stored reads the account's current address, only when the new one fails
// the format rule. An unchanged address is kept: accounts made under the
// older net/mail rule stay editable, and a changed address must pass.
func validateUpdate(req UpdateUserRequest, stored func() (string, error)) map[string]string {
	errs := map[string]string{}
	put(errs, "email", validateEmail(req.Email))
	if errs["email"] == validate.EmailMessage {
		if prior, err := stored(); err == nil && normalizeEmail(prior) == normalizeEmail(req.Email) {
			delete(errs, "email")
		}
	}
	put(errs, "name", validateName(req.Name))
	put(errs, "role", validateRole(req.Role))
	if len(errs) == 0 {
		return nil
	}
	return errs
}
