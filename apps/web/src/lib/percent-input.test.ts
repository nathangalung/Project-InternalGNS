import { describe, expect, it } from "vitest"
import { PERCENT_ERROR, parsePercent, percentShown } from "./percent-input"

describe("percent input", () => {
  // Typed text, then the value kept or the refusal.
  it.each([
    ["2,5", { value: "2.5" }],
    ["2.5", { value: "2.5" }],
    ["10", { value: "10" }],
    ["100,00", { value: "100" }],
    ["0,05", { value: "0.05" }],
    [" 12,5 % ", { value: "12.5" }],
    ["0", { value: "0" }],
    ["", { value: null }],
    ["  ", { value: null }],
    ["101", { error: PERCENT_ERROR }],
    ["100,01", { error: PERCENT_ERROR }],
    ["abc", { error: PERCENT_ERROR }],
    ["2,555", { error: PERCENT_ERROR }],
    ["-5", { error: PERCENT_ERROR }],
    ["1.000", { error: PERCENT_ERROR }],
  ])("%j", (typed, want) => {
    expect(parsePercent(typed)).toEqual(want)
  })

  // A stored percent shows with a decimal comma.
  it.each<[number, string]>([
    [2.5, "2,5"],
    [10, "10"],
    [0, ""],
  ])("shows %s as %j", (stored, shown) => {
    expect(percentShown(stored)).toBe(shown)
  })
})
