// Mirrors users.ValidatePassword on the API.
export type PasswordRule = {
  key: "length" | "upper" | "digit" | "symbol"
  label: string
  test: (pw: string) => boolean
}

// bcrypt input limit, UTF-8 bytes.
export const PASSWORD_MAX_BYTES = 72

export const PASSWORD_TOO_LONG_MESSAGE = `Kata sandi terlalu panjang, maksimal ${PASSWORD_MAX_BYTES} karakter.`

export const PASSWORD_RULES: readonly PasswordRule[] = [
  // Code points, as the API counts runes
  { key: "length", label: "Minimal 8 karakter", test: (p) => [...p].length >= 8 },
  { key: "upper", label: "1 huruf kapital (A-Z)", test: (p) => /\p{Lu}/u.test(p) },
  { key: "digit", label: "1 angka (0-9)", test: (p) => /\p{Nd}/u.test(p) },
  // Anything neither letter nor digit
  { key: "symbol", label: "1 simbol (!@#$%^&* dll.)", test: (p) => /[^\p{L}\p{Nd}]/u.test(p) },
]

const encoder = new TextEncoder()

// Over the bcrypt byte limit.
export function passwordTooLong(pw: string): boolean {
  return encoder.encode(pw).length > PASSWORD_MAX_BYTES
}

export function passwordIsValid(pw: string): boolean {
  return !passwordTooLong(pw) && PASSWORD_RULES.every((r) => r.test(pw))
}
