import { describe, expect, it } from "vitest"
import type { UnitRow } from "@/types/api"
import { matchUnits, unitLabel } from "./match"

const units: UnitRow[] = [
  { id: 1, code: "PCS", name: "Piece" },
  { id: 2, code: "KG", name: "Kilogram" },
  { id: 3, code: "SET" },
  { id: 4, code: "PCT", name: "Persen" },
  { id: 5, code: "M2", name: "Meter Persegi" },
  { id: 6, code: "MTR", name: "Meter" },
  { id: 7, code: "LAP", name: "Laporan" },
]

describe("matchUnits", () => {
  it.each([
    ["blank", "  ", []],
    ["code, any case", "kg", ["KG"]],
    ["name", "piece", ["PCS"]],
    ["unnamed unit by code", "set", ["SET"]],
    ["trimmed", " pc ", ["PCS", "PCT"]],
  ])("%s", (_, query, codes) => {
    expect(matchUnits(units, query).map((u) => u.code)).toEqual(codes)
  })

  it("keeps the first five", () => {
    expect(matchUnits(units, "e")).toHaveLength(5)
    expect(matchUnits(units, "e", 2).map((u) => u.code)).toEqual(["PCS", "SET"])
  })
})

describe("unitLabel", () => {
  it.each([
    [units[0], "PCS - Piece"],
    [units[2], "SET"],
  ])("labels %o", (unit, label) => {
    expect(unitLabel(unit)).toBe(label)
  })
})
