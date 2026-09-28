// Form field rules.
//
// Phone and email mirror apps/api/internal/shared/validate, which is the
// source of truth; its testdata/contact_rules.json runs against both copies,
// so change the Go rule and that table first. The address rule has no server
// counterpart and is a form rule only.

export const PHONE_ERROR = "Nomor telepon harus 9–12 digit angka."

export const EMAIL_ERROR = "Format email tidak valid."

export const ADDRESS_ERROR = "Alamat harus minimal 20 karakter dan mengandung huruf."

// Matches company_contacts_phone_check.
const PHONE_MIN_DIGITS = 9
const PHONE_MAX_DIGITS = 12

// The Go rule, verbatim.
const EMAIL_PATTERN =
  /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@([A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,}$/

// ASCII digits of s.
export function digitsOnly(s: string): string {
  return s.replace(/[^0-9]/g, "")
}

// Counts digits, ignores separators.
export function isValidPhone(s: string): boolean {
  const n = digitsOnly(s).length
  return n >= PHONE_MIN_DIGITS && n <= PHONE_MAX_DIGITS
}

// Checked as given; trim first.
export function isValidEmail(s: string): boolean {
  return EMAIL_PATTERN.test(s)
}

export function isValidAddress(s: string): boolean {
  const t = s.trim()
  return t.length >= 20 && /[a-zA-Z]/.test(t)
}

// Optional phone, checked once filled.
export function optionalPhoneError(s: string): string | null {
  const t = s.trim()
  return t === "" || isValidPhone(t) ? null : PHONE_ERROR
}

// Optional email, checked once filled.
export function optionalEmailError(s: string): string | null {
  const t = s.trim()
  return t === "" || isValidEmail(t) ? null : EMAIL_ERROR
}

// Optional address, checked once filled.
//
// The quotation may go out without one; the PO gate asks for it before the
// work starts.
export function optionalAddressError(s: string): string | null {
  return s.trim() === "" || isValidAddress(s) ? null : ADDRESS_ERROR
}
