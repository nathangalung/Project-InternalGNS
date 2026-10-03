import { describe, expect, it } from "vitest"
import {
  ADDRESS_ERROR,
  digitsOnly,
  EMAIL_ERROR,
  isValidAddress,
  isValidEmail,
  isValidPhone,
  NPWP_ERROR,
  optionalAddressError,
  optionalEmailError,
  optionalNpwpError,
  optionalPhoneError,
  PHONE_ERROR,
} from "./validation"

type RuleCase = { input: string; valid: boolean; note?: string }

type RuleTable = {
  messages: { phone: string; email: string }
  phone: RuleCase[]
  email: RuleCase[]
}

// The API's rule table.
//
// A glob rather than an import: the web image builds with only apps/web in
// its context, and tsc would fail to resolve a path into apps/api.
const tables = import.meta.glob<RuleTable>(
  "../../../api/internal/shared/validate/testdata/contact_rules.json",
  { eager: true, import: "default" },
)
const rules = Object.values(tables)[0]

describe("shared rule table", () => {
  it("is found", () => {
    expect(Object.keys(tables)).toHaveLength(1)
    expect(rules.phone.length).toBeGreaterThan(0)
    expect(rules.email.length).toBeGreaterThan(0)
  })

  it("carries the same messages", () => {
    expect(PHONE_ERROR).toBe(rules.messages.phone)
    expect(EMAIL_ERROR).toBe(rules.messages.email)
  })

  it.each(rules.phone)("phone $input -> $valid", ({ input, valid }) => {
    expect(isValidPhone(input)).toBe(valid)
  })

  it.each(rules.email)("email $input -> $valid", ({ input, valid }) => {
    expect(isValidEmail(input)).toBe(valid)
  })
})

describe("optionalPhoneError", () => {
  it.each<[string, string | null]>([
    ["", null],
    ["   ", null],
    ["812345678", null],
    [" 812345678901 ", null],
    ["8123456789012", PHONE_ERROR],
    ["81234567", PHONE_ERROR],
  ])("%j -> %j", (s, want) => {
    expect(optionalPhoneError(s)).toBe(want)
  })
})

describe("optionalEmailError", () => {
  it.each<[string, string | null]>([
    ["", null],
    ["  ", null],
    ["budi@contoh.co.id", null],
    ["  budi@contoh.co.id  ", null],
    ["budi@contoh", EMAIL_ERROR],
    ["budi contoh@x.id", EMAIL_ERROR],
  ])("%j -> %j", (s, want) => {
    expect(optionalEmailError(s)).toBe(want)
  })
})

describe("isValidAddress", () => {
  it.each<[string, boolean]>([
    ["Jl. Pelabuhan No. 12, Jakarta Utara", true],
    ["  Jl. Pelabuhan No. 12, Jakarta  ", true],
    ["Jl. Pendek", false],
    ["12345678901234567890", false],
    ["", false],
  ])("%j -> %s", (s, ok) => {
    expect(isValidAddress(s)).toBe(ok)
  })
})

describe("optionalAddressError", () => {
  it.each<[string, string | null]>([
    ["", null],
    ["   ", null],
    ["Jl. Pelabuhan No. 12, Jakarta Utara", null],
    ["Jl. Pendek", ADDRESS_ERROR],
    ["12345678901234567890", ADDRESS_ERROR],
  ])("%j -> %j", (s, want) => {
    expect(optionalAddressError(s)).toBe(want)
  })

  it("names the rule in Indonesian", () => {
    expect(ADDRESS_ERROR).toBe("Alamat harus minimal 20 karakter dan mengandung huruf.")
  })
})

describe("digitsOnly", () => {
  it.each<[string, string]>([
    ["01.234.567.8-901.000", "012345678901000"],
    ["+62 812-3456", "628123456"],
    ["abc", ""],
  ])("%j -> %j", (s, want) => {
    expect(digitsOnly(s)).toBe(want)
  })
})

describe("optionalNpwpError", () => {
  it.each([
    ["", "IDN", null],
    ["   ", "IDN", null],
    ["0123456789012345", "IDN", null],
    ["01.234.567.89.012.345", "IDN", null],
    ["01.234.567.8-901.000", "IDN", NPWP_ERROR],
    ["12345", "", NPWP_ERROR],
    ["NPWP0123456789012", "IDN", NPWP_ERROR],
    ["T08LL1234A", "SGP", null],
  ])("%j for %j is %j", (value, country, want) => {
    expect(optionalNpwpError(value, country)).toBe(want)
  })
})
