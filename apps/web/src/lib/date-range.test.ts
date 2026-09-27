import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { type DatePreset, presetRange, resolveRange, yearInJakarta } from "./date-range"

describe("resolveRange", () => {
  afterEach(() => vi.useRealTimers())

  it("passes a custom range through untouched", () => {
    expect(resolveRange("kustom", "2026-01-05", "2026-02-10")).toEqual({
      start: "2026-01-05",
      end: "2026-02-10",
    })
  })

  it("sends no bounds for Semua", () => {
    expect(resolveRange("semua", "2026-01-05", "2026-02-10")).toEqual({ start: "", end: "" })
  })

  // 14:00 WIB, one shared day.
  //
  // The same calendar day in UTC and WIB.
  it.each<[string, string, string]>([
    ["7-hari", "2026-09-17", "2026-09-24"],
    ["30-hari", "2026-08-25", "2026-09-24"],
    ["unknown preset is today only", "2026-09-24", "2026-09-24"],
  ])("%s ends today", (preset, start, end) => {
    vi.useFakeTimers({ now: new Date("2026-09-24T14:00:00+07:00") })
    expect(resolveRange(preset, "", "")).toEqual({ start, end })
  })

  // Regression: before 07:00 WIB.
  //
  // Before 07:00 WIB the UTC date is still yesterday, and the server reads
  // dateTo as an inclusive WIB day, so today's rows vanished.
  it.each<[string, string, string]>([
    ["7-hari", "2026-09-17", "2026-09-24"],
    ["30-hari", "2026-08-25", "2026-09-24"],
  ])("%s uses the WIB day just after midnight", (preset, start, end) => {
    vi.useFakeTimers({ now: new Date("2026-09-24T02:30:00+07:00") })
    expect(resolveRange(preset, "", "")).toEqual({ start, end })
  })

  it("crosses a month and a year boundary in WIB", () => {
    vi.useFakeTimers({ now: new Date("2027-01-03T00:15:00+07:00") })
    expect(resolveRange("7-hari", "", "")).toEqual({ start: "2026-12-27", end: "2027-01-03" })
  })
})

// Filter seeds from any zone.
//
// The filter modal fills its date inputs from the preset; the days are WIB
// days even when the browser's own date is still yesterday.
describe("presetRange", () => {
  beforeEach(() => {
    vi.stubEnv("TZ", "America/Los_Angeles")
    // 02:30 WIB on the 24th is 12:30 on the 23rd in Los Angeles.
    vi.useFakeTimers({ now: new Date("2026-09-24T02:30:00+07:00") })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  it.each<[DatePreset, string, string]>([
    ["hari-ini", "2026-09-24", "2026-09-24"],
    ["7-hari", "2026-09-17", "2026-09-24"],
    ["30-hari", "2026-08-25", "2026-09-24"],
    // Kustom opens on the last 30 days.
    ["kustom", "2026-08-25", "2026-09-24"],
    ["semua", "", ""],
  ])("%s", (preset, start, end) => {
    expect(presetRange(preset)).toEqual({ start, end })
  })

  it("reads the WIB year", () => {
    vi.setSystemTime(new Date("2027-01-01T00:30:00+07:00"))
    expect(yearInJakarta()).toBe(2027)
  })
})
