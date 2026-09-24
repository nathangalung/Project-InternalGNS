import { afterEach, describe, expect, it, vi } from "vitest"
import { resolveRange } from "./date-range"

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

  // 14:00 WIB, the same calendar day in UTC and WIB.
  it.each<[string, string, string]>([
    ["7-hari", "2026-09-17", "2026-09-24"],
    ["30-hari", "2026-08-25", "2026-09-24"],
    ["unknown preset is today only", "2026-09-24", "2026-09-24"],
  ])("%s ends today", (preset, start, end) => {
    vi.useFakeTimers({ now: new Date("2026-09-24T14:00:00+07:00") })
    expect(resolveRange(preset, "", "")).toEqual({ start, end })
  })

  // Regression: before 07:00 WIB the UTC date is still yesterday, and the
  // server reads dateTo as an inclusive WIB day, so today's rows vanished.
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
