import { describe, expect, it } from "vitest"
import { PASSWORD_MAX_BYTES, passwordIsValid, passwordTooLong } from "./password"

// Mirrors users.ValidatePassword on the API.
describe("passwordIsValid", () => {
  it.each([
    ["Rahasia1!", true],
    ["rahasia1!", false],
    ["Rahasia!!", false],
    ["Rahasia12", false],
    ["Rah1!", false],
    // Space is neither letter nor digit
    ["Rahasia 1", true],
    // A lower-case accented letter is not a symbol
    ["Rahasiaé1", false],
    // Non-ASCII capital counts as upper
    ["Érahasia1!", true],
    // Eight code points, not UTF-16 units
    ["Ab1!\u{1D11E}\u{1D11E}\u{1D11E}\u{1D11E}", true],
    ["Ab1!\u{1D11E}\u{1D11E}\u{1D11E}", false],
    // Titlecase is a letter, not upper
    ["Rahasia1\u01C5", false],
    // Superscript two is no digit
    ["Rahasia\u00B2!", false],
    ["Rahasia1\u00B2", true],
    // Arabic-Indic three is a digit
    ["Rahasia\u0663!", true],
    // A combining mark is a symbol
    ["Rahasia1\u0301", true],
    ["Rahasia1\u{1F600}", true],
  ])("%s -> %s", (pw, ok) => {
    expect(passwordIsValid(pw)).toBe(ok)
  })

  it("rejects more than 72 bytes", () => {
    const at = `Aa1!${"a".repeat(PASSWORD_MAX_BYTES - 4)}`
    expect(passwordTooLong(at)).toBe(false)
    expect(passwordIsValid(at)).toBe(true)
    expect(passwordTooLong(`${at}a`)).toBe(true)
    expect(passwordIsValid(`${at}a`)).toBe(false)
  })

  it("counts bytes, not characters", () => {
    // 36 two-byte letters plus four ASCII is 76 bytes
    const pw = `Aa1!${"é".repeat(36)}`
    expect(passwordTooLong(pw)).toBe(true)
  })
})
