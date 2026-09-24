import { describe, expect, it } from "vitest"
import { hashCode, LOGO_BG_PALETTE, logoBackground } from "./avatar"

describe("logoBackground", () => {
  it("gives the same name the same colour on every render", () => {
    expect(logoBackground("PT Samudera Jaya")).toBe(logoBackground("PT Samudera Jaya"))
  })

  it("always picks a palette colour, even for an empty name", () => {
    for (const name of ["", "A", "PT Global Niaga Sakti", "x".repeat(500)]) {
      expect(LOGO_BG_PALETTE).toContain(logoBackground(name))
    }
  })

  it("spreads different names over the palette", () => {
    const names = Array.from({ length: 50 }, (_, i) => `Klien ${i}`)
    expect(new Set(names.map(logoBackground)).size).toBeGreaterThan(3)
  })
})

describe("hashCode", () => {
  it("is never negative, so the palette index is always valid", () => {
    // A long string overflows the 32-bit accumulator into negatives.
    expect(hashCode("z".repeat(1000))).toBeGreaterThanOrEqual(0)
    expect(hashCode("")).toBe(0)
  })
})
