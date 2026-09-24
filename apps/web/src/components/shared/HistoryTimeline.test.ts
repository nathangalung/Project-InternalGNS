import { describe, expect, it } from "vitest"
import { isActiveEntry, timelineDot } from "./HistoryTimeline"

describe("isActiveEntry", () => {
  it("marks the newest entry by default", () => {
    const e = { date: "d", action: "a" }
    expect([0, 1, 2].map((i) => isActiveEntry(e, i, 3))).toEqual([false, false, true])
  })

  it("follows an explicit mark over position", () => {
    expect(isActiveEntry({ date: "d", action: "a", active: true }, 0, 3)).toBe(true)
    expect(isActiveEntry({ date: "d", action: "a", active: false }, 2, 3)).toBe(false)
  })
})

describe("timelineDot", () => {
  it("fills only the active dot", () => {
    expect(timelineDot(true)).toContain("bg-primary-700")
    expect(timelineDot(false)).toContain("bg-white")
  })
})
