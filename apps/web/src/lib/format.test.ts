import { describe, expect, it } from "vitest"
import {
  computeTaxBreakdown,
  formatDate,
  formatDateTime,
  formatNumber,
  formatRupiah,
  formatRupiahAxis,
  toNum,
} from "./format"

describe("formatRupiah", () => {
  it.each<[string, string | number | null, string]>([
    ["whole amount", 1_500_000, "Rp1.500.000"],
    ["numeric string", "1500000.00", "Rp1.500.000"],
    ["one sen digit pads to two", "16155994.5", "Rp16.155.994,50"],
    ["two sen digits", "11425333.34", "Rp11.425.333,34"],
    ["third digit rounds", 10.005, "Rp10,01"],
    ["rounds to whole", 99.999, "Rp100"],
    ["zero uses the fallback", 0, "Rp0"],
    ["null uses the fallback", null, "Rp0"],
  ])("%s", (_name, value, want) => {
    expect(formatRupiah(value)).toBe(want)
  })
})

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

describe("toNum", () => {
  it.each<[string, string | number | null | undefined, number]>([
    ["number", 12.5, 12.5],
    ["numeric string", "1500000.00", 1_500_000],
    ["null", null, 0],
    ["undefined", undefined, 0],
    ["empty string", "", 0],
    ["junk", "abc", 0],
    ["infinity", Number.POSITIVE_INFINITY, 0],
  ])("%s", (_name, v, want) => {
    expect(toNum(v)).toBe(want)
  })
})

describe("formatRupiah fallbacks", () => {
  it.each<[string, string | number | undefined]>([
    ["undefined", undefined],
    ["empty string", ""],
    ["junk", "abc"],
    ["infinity", Number.POSITIVE_INFINITY],
  ])("%s", (_name, v) => {
    expect(formatRupiah(v, "-")).toBe("-")
  })

  it("keeps the minus sign on a negative amount", () => {
    expect(formatRupiah(-2500)).toBe("Rp-2.500")
  })
})

describe("formatNumber", () => {
  it.each<[string, string | number | null | undefined, string]>([
    ["thousands", 1234567, "1.234.567"],
    ["decimal comma", "1234567.5", "1.234.567,5"],
    ["zero is a number, not the fallback", 0, "0"],
    ["null", null, "-"],
    ["undefined", undefined, "-"],
    ["empty string", "", "-"],
    ["junk", "abc", "-"],
  ])("%s", (_name, v, want) => {
    expect(formatNumber(v, "-")).toBe(want)
  })

  it("defaults the fallback to 0", () => {
    expect(formatNumber(null)).toBe("0")
  })
})

// Noon UTC is the same calendar day on any host timezone.
describe("formatDate and formatDateTime", () => {
  it("prints an Indonesian short date", () => {
    expect(formatDate("2026-09-24T12:00:00Z")).toBe("24 Sep 2026")
  })

  it("adds the time after a comma", () => {
    expect(formatDateTime("2026-09-24T12:00:00Z")).toMatch(/^24 Sep 2026, \d{2}\.\d{2}$/)
  })

  it.each([formatDate, formatDateTime])("returns an empty string for no date", (fn) => {
    expect(fn(null)).toBe("")
    expect(fn(undefined)).toBe("")
    expect(fn("")).toBe("")
  })

  it.each([formatDate, formatDateTime])("returns an unparseable value as given", (fn) => {
    expect(fn("bukan tanggal")).toBe("bukan tanggal")
  })
})
