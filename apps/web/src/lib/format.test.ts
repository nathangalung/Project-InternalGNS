import { describe, expect, it } from "vitest"
import { computeTaxBreakdown, formatRupiahAxis } from "./format"

describe("formatRupiahAxis", () => {
  it("returns the raw value below one thousand", () => {
    expect(formatRupiahAxis(0)).toBe("Rp 0")
    expect(formatRupiahAxis(750)).toBe("Rp 750")
  })

  it("suffixes thousands with K", () => {
    expect(formatRupiahAxis(5_000)).toBe("Rp 5K")
    expect(formatRupiahAxis(999_000)).toBe("Rp 999K")
  })

  it("suffixes millions with Jt (juta)", () => {
    expect(formatRupiahAxis(1_000_000)).toBe("Rp 1Jt")
    expect(formatRupiahAxis(250_000_000)).toBe("Rp 250Jt")
  })

  it("suffixes billions with M (miliar)", () => {
    expect(formatRupiahAxis(1_000_000_000)).toBe("Rp 1M")
    expect(formatRupiahAxis(12_000_000_000)).toBe("Rp 12M")
  })

  it("keeps ticks increasing across the million/billion boundary", () => {
    // Regression: both branches used to emit "M", so 500M read larger than 1B.
    expect(formatRupiahAxis(500_000_000)).toBe("Rp 500Jt")
    expect(formatRupiahAxis(1_000_000_000)).toBe("Rp 1M")
    expect(formatRupiahAxis(500_000_000)).not.toBe(formatRupiahAxis(1_000_000_000))
  })
})

describe("computeTaxBreakdown", () => {
  it("includes shipping in the taxable base (matches DB (total-discount)*1.11)", () => {
    // products=1000, shipping=200, no discount -> base 1200 -> grand 1332.
    const r = computeTaxBreakdown({ subtotal: 1000, shipping: 200 })
    expect(r.dppNilaiLain).toBe(1100)
    expect(r.ppnAmount).toBe(132)
    expect(r.grandTotal).toBe(1332)
  })

  it("products only (no shipping): base 1000 -> dpp 917 -> ppn 110 -> grand 1110", () => {
    const r = computeTaxBreakdown({ subtotal: 1000, shipping: 0 })
    expect(r.dppNilaiLain).toBe(917)
    expect(r.ppnAmount).toBe(110)
    expect(r.grandTotal).toBe(1110)
  })

  it("shipping only (no products) taxes the shipping cost", () => {
    const r = computeTaxBreakdown({ subtotal: 0, shipping: 200 })
    expect(r.dppNilaiLain).toBe(Math.round((200 * 11) / 12))
    expect(r.grandTotal).toBe(200 + r.ppnAmount)
  })

  it("grandTotal always equals base + ppn", () => {
    const r = computeTaxBreakdown({ subtotal: 5000, shipping: 750 })
    expect(r.grandTotal).toBe(5000 + 750 + r.ppnAmount)
  })
})
