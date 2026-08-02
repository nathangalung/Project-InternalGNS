import { describe, expect, it } from "vitest"
import {
  buildDailySeries,
  buildSeries,
  dayLabels,
  daysInMonth,
  monthRange,
  yearRange,
} from "./chart"

describe("buildSeries", () => {
  it("maps YYYY-MM buckets into 12 month slots for the base year", () => {
    const s = buildSeries(
      [
        { month: "2026-01", value: "5" },
        { month: "2026-12", value: "9" },
      ],
      2026,
    )
    expect(s).toHaveLength(12)
    expect(s[0]).toBe(5)
    expect(s[11]).toBe(9)
  })

  it("ignores other years and returns zeros when undefined", () => {
    expect(buildSeries([{ month: "2025-01", value: "5" }], 2026)[0]).toBe(0)
    expect(buildSeries(undefined, 2026)).toEqual(new Array(12).fill(0))
  })
})

describe("daysInMonth / dayLabels", () => {
  it("handles month lengths incl. leap February", () => {
    expect(daysInMonth(2026, 1)).toBe(28) // Feb 2026
    expect(daysInMonth(2024, 1)).toBe(29) // Feb 2024 leap
    expect(daysInMonth(2026, 3)).toBe(30) // Apr
  })

  it("labels run 1..N", () => {
    expect(dayLabels(2026, 3)).toHaveLength(30)
    expect(dayLabels(2026, 3)[0]).toBe("1")
    expect(dayLabels(2026, 3)[29]).toBe("30")
  })
})

describe("buildDailySeries", () => {
  it("maps YYYY-MM-DD buckets into day-indexed slots", () => {
    const s = buildDailySeries(
      [
        { month: "2026-04-01", value: "3" },
        { month: "2026-04-17", value: "8" },
        { month: "2026-04-30", value: "2" },
      ],
      2026,
      3,
    )
    expect(s).toHaveLength(30)
    expect(s[0]).toBe(3)
    expect(s[16]).toBe(8)
    expect(s[29]).toBe(2)
  })

  it("skips buckets from other months", () => {
    const s = buildDailySeries([{ month: "2026-05-01", value: "9" }], 2026, 3)
    expect(s.every((v) => v === 0)).toBe(true)
  })
})

describe("yearRange / monthRange", () => {
  it("year range is inclusive-from, exclusive-to (Dec 31 included)", () => {
    expect(yearRange(2026)).toEqual({ from: "2026-01-01", to: "2027-01-01" })
  })

  it("month range exclusive-to rolls to next month", () => {
    expect(monthRange(2026, 3)).toEqual({ from: "2026-04-01", to: "2026-05-01" })
  })

  it("December rolls to next year", () => {
    expect(monthRange(2026, 11)).toEqual({ from: "2026-12-01", to: "2027-01-01" })
  })
})
