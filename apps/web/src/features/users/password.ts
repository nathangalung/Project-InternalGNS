export interface PasswordRule {
  key: "length" | "upper" | "digit" | "symbol"
  label: string
  test: (pw: string) => boolean
}

export const PASSWORD_RULES: readonly PasswordRule[] = [
  { key: "length", label: "Minimal 8 karakter",       test: (p) => p.length >= 8 },
  { key: "upper",  label: "1 huruf kapital (A-Z)",    test: (p) => /[A-Z]/.test(p) },
  { key: "digit",  label: "1 angka (0-9)",            test: (p) => /\d/.test(p) },
  { key: "symbol", label: "1 simbol (!@#$%^&* dll.)", test: (p) => /[^A-Za-z0-9]/.test(p) },
]

export function passwordIsValid(pw: string): boolean {
  return PASSWORD_RULES.every(r => r.test(pw))
}
