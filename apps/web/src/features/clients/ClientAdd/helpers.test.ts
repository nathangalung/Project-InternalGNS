import { describe, expect, it } from "vitest"
import { ADDRESS_ERROR, isValidAddress, optionalAddressError } from "./helpers"

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
