package users

import (
	"fmt"
	"net/mail"
	"strings"
	"unicode"
)

// Password bounds. The maximum is bcrypt's own input limit: anything longer
// made the hash call fail and surfaced as a 500.
const (
	passwordMinRunes = 8
	passwordMaxBytes = 72
)

// ValidatePassword returns the policy message, or "" when pw passes.
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

// validateEmail rejects anything the address column cannot resolve to one
// mailbox, including the "Nama <a@b>" display form net/mail also parses.
func validateEmail(email string) string {
	trimmed := strings.TrimSpace(email)
	if trimmed == "" {
		return "Email wajib diisi."
	}
	addr, err := mail.ParseAddress(trimmed)
	if err != nil || addr.Address != trimmed || addr.Name != "" {
		return "Format email tidak valid."
	}
	return ""
}

// validateName rejects a name that is only whitespace.
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

// put records a message when there is one.
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
func validateUpdate(req UpdateUserRequest) map[string]string {
	errs := map[string]string{}
	put(errs, "email", validateEmail(req.Email))
	put(errs, "name", validateName(req.Name))
	put(errs, "role", validateRole(req.Role))
	if len(errs) == 0 {
		return nil
	}
	return errs
}
