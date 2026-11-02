import { describe, expect, it } from "vitest"
import { moneyFromStored, moneyShown, moneyTyped } from "./money-input"

describe("money input", () => {
  // Typed or pasted text, the value kept, what the input shows.
  it.each([
    ["200.000", "200000", "200.000"],
    ["200.000,50", "200000.50", "200.000,50"],
    ["Rp 200.000", "200000", "200.000"],
    ["Rp200.000,5", "200000.5", "200.000,5"],
    ["200000", "200000", "200.000"],
    ["4.500.000", "4500000", "4.500.000"],
    ["12,5", "12.5", "12,5"],
    ["1.250,755", "1250.75", "1.250,75"],
    ["1,2,3", "1.23", "1,23"],
    ["12,", "12.", "12,"],
    [",5", "0.5", "0,5"],
    ["007", "7", "7"],
    ["0", "0", "0"],
    ["Rp 1a2", "12", "12"],
    ["", "", ""],
  ])("%s", (raw, canonical, shown) => {
    expect(moneyTyped(raw)).toBe(canonical)
    expect(moneyShown(canonical)).toBe(shown)
  })

  // A typed value survives a round trip through the input.
  it.each(["200.000", "200.000,50", "12,", "0,5"])("keeps %s while typing", (shown) => {
    expect(moneyShown(moneyTyped(shown))).toBe(shown)
  })

  // Stored decimals drop only empty sen.
  it.each<[string | number | undefined | null, string]>([
    ["60000.00", "60000"],
    ["60000.50", "60000.50"],
    ["60000", "60000"],
    [60000, "60000"],
    [1250.5, "1250.5"],
    ["", ""],
    [undefined, ""],
    [null, ""],
  ])("stored %j", (stored, canonical) => {
    expect(moneyFromStored(stored)).toBe(canonical)
  })
})
