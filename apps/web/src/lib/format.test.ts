import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  computeTaxBreakdown,
  formatAddress,
  formatDate,
  formatDateShort,
  formatDateTime,
  formatNumber,
  formatRupiah,
  formatRupiahAxis,
  lineNet,
  sumRupiah,
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

describe("lineNet", () => {
  it.each<[string, number, number, number, number]>([
    ["no discount", 2, 1500, 0, 3000],
    ["rounds half away from zero", 1, 0.01, 50, 0.01],
    ["drops below half a sen", 3, 0.97, 2.5, 2.84],
    ["fractional qty, half a sen up", 1.5, 0.33, 0, 0.5],
    ["full discount", 4, 999.99, 100, 0],
    ["large amount stays exact", 1000, 123_456_789.99, 2.5, 120_370_370_240.25],
  ])("%s", (_name, qty, price, pct, want) => {
    expect(lineNet(qty, price, pct)).toBe(want)
  })
})

describe("sumRupiah", () => {
  it("adds in sen without float noise", () => {
    expect(sumRupiah([0.1, 0.2])).toBe(0.3)
    expect(sumRupiah([])).toBe(0)
  })
})

describe("computeTaxBreakdown", () => {
  it("rounds per line, as the server stores it", () => {
    // The Go TestQuotationTax_PerLine case: 2.5% off three lines plus 100.01
    // shipping. The header formula would give 8115.97, 973.92 and 9827.71.
    const nets = [lineNet(1, 333.33, 2.5), lineNet(3, 0.97, 2.5), lineNet(7, 1234.57, 2.5), 100.01]
    expect(computeTaxBreakdown(nets)).toEqual({
      subtotal: 8853.79,
      dppNilaiLain: 8115.98,
      ppnAmount: 973.91,
      grandTotal: 9827.7,
    })
  })

  it("charges no tax without PPN", () => {
    expect(computeTaxBreakdown([100.5, 20], false)).toEqual({
      subtotal: 120.5,
      dppNilaiLain: 0,
      ppnAmount: 0,
      grandTotal: 120.5,
    })
  })

  it("taxes shipping as a line of its own", () => {
    expect(computeTaxBreakdown([1000, 200])).toEqual({
      subtotal: 1200,
      dppNilaiLain: 1100,
      ppnAmount: 132,
      grandTotal: 1332,
    })
  })

  it("is zero without lines", () => {
    expect(computeTaxBreakdown([])).toEqual({
      subtotal: 0,
      dppNilaiLain: 0,
      ppnAmount: 0,
      grandTotal: 0,
    })
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

// Noon UTC: same day, UTC-12..+11.
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

// A browser outside Jakarta.
//
// Document dates are WIB days: a date-only value keeps its day, and a
// timestamp lands on the WIB calendar, whatever zone the browser runs in.
describe("dates read in WIB from any browser zone", () => {
  beforeEach(() => vi.stubEnv("TZ", "America/Los_Angeles"))
  afterEach(() => vi.unstubAllEnvs())

  it.each<[string, string]>([
    ["a date-only value keeps its day", "2026-09-27"],
    ["a DATE column at UTC midnight keeps its day", "2026-09-27T00:00:00Z"],
    ["a WIB midnight keeps its day", "2026-09-27T00:00:00+07:00"],
  ])("%s", (_name, iso) => {
    expect(formatDate(iso)).toBe("27 Sep 2026")
  })

  it("puts a UTC evening on the next WIB day", () => {
    expect(formatDate("2026-09-27T20:00:00Z")).toBe("28 Sep 2026")
    expect(formatDateTime("2026-09-27T20:05:00Z")).toBe("28 Sep 2026, 03.05")
  })

  it("prints the unpadded day in WIB", () => {
    expect(formatDateShort("2026-09-04T20:00:00Z")).toBe("5 Sep 2026")
    expect(formatDateShort("2026-08-04T12:00:00Z")).toBe("4 Agu 2026")
    expect(formatDateShort("")).toBe("")
    expect(formatDateShort("bukan tanggal")).toBe("bukan tanggal")
  })
})

describe("formatAddress", () => {
  it.each([
    {
      name: "line breaks and stray spaces",
      input:
        "GEDUNG TCC LT 11 JL KH MAS MANSYUR KAV 126 ,  \n RT 009,  RW 003, KARET TENGSIN,  \n DKI JAKARTA 10220",
      want: "GEDUNG TCC LT 11 JL KH MAS MANSYUR KAV 126, RT 009, RW 003, KARET TENGSIN, DKI JAKARTA 10220",
    },
    {
      name: "a glued postal code",
      input: "CIRACAS JAKARTA TIMUR,13740",
      want: "CIRACAS JAKARTA TIMUR, 13740",
    },
    {
      name: "house number lists stay",
      input: "Blok G No. 2,6,8, Jl. Hayam wuruk No.2-5",
      want: "Blok G No. 2,6,8, Jl. Hayam wuruk No.2-5",
    },
    {
      name: "doubled and trailing commas",
      input: " , Jl. A,, Jakarta ,\r\n",
      want: "Jl. A, Jakarta",
    },
    { name: "blank", input: "  \n ", want: "" },
    { name: "missing", input: undefined, want: "" },
  ])("$name", ({ input, want }) => {
    expect(formatAddress(input)).toBe(want)
  })
})
