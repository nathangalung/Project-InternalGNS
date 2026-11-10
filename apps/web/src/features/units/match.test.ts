import { describe, expect, it } from "vitest"
import type { UnitRow } from "@/types/api"
import {
  matchUnits,
  normalizeUnitText,
  resolveUnit,
  unitChoices,
  unitCode,
  unitIndex,
  unitLabel,
  unitOption,
} from "./match"

const units: UnitRow[] = [
  { id: 1, code: "PCS", isActive: true, name: "Piece", aliases: ["EA", "PC", "PIECES"] },
  { id: 2, code: "KG", isActive: true, name: "Kilogram", aliases: ["KGS"] },
  { id: 3, code: "SET", isActive: true, aliases: [] },
  { id: 4, code: "PCT", isActive: true, name: "Persen", aliases: [] },
  { id: 5, code: "M2", isActive: true, name: "Meter Persegi", aliases: [] },
  { id: 6, code: "MTR", isActive: true, name: "Meter", aliases: ["METER"] },
  { id: 7, code: "LAP", isActive: true, name: "Laporan", aliases: [] },
  { id: 8, code: "RLS", isActive: true, name: "Rolls", aliases: ["GULUNG", "ROLL"] },
  { id: 9, code: "TIN", isActive: true, name: "Tin", aliases: ["TINS"] },
  { id: 10, code: "CAN", isActive: true, name: "Can", aliases: ["CANS"] },
  { id: 11, code: "OTH", isActive: false, name: "Lainnya", aliases: [] },
]

describe("normalizeUnitText", () => {
  it.each([
    ["pcs.", "PCS"],
    ["  Pieces  ", "PIECES"],
    ["big   bag..", "BIG BAG"],
    ["pcs .", "PCS"],
    [" . ", ""],
    ["", ""],
  ])("%j reads as %j", (text, want) => {
    expect(normalizeUnitText(text)).toBe(want)
  })
})

describe("resolveUnit", () => {
  const index = unitIndex(units)

  it.each([
    ["a code", "PCS", "PCS"],
    ["a code with a dot", "pcs.", "PCS"],
    ["an alias", "Pieces", "PCS"],
    ["a short alias", "EA", "PCS"],
    ["an alias in lower case", "roll", "RLS"],
    ["an Indonesian alias", "gulung", "RLS"],
  ])("finds %s", (_, text, code) => {
    expect(resolveUnit(index, text)?.code).toBe(code)
  })

  it.each([
    ["an unknown text", "drum"],
    ["a blank text", "  "],
    ["a name", "Piece"],
  ])("finds nothing for %s", (_, text) => {
    expect(resolveUnit(index, text)).toBeUndefined()
  })

  it("lets a code win over an alias", () => {
    const clash = unitIndex([
      { id: 1, code: "PCS", isActive: true, aliases: ["SET"] },
      { id: 2, code: "SET", isActive: true, aliases: [] },
    ])
    expect(resolveUnit(clash, "set")?.id).toBe(2)
  })

  it("is empty before the units load", () => {
    expect(unitIndex(undefined).size).toBe(0)
  })
})

describe("unitCode", () => {
  const index = unitIndex(units)

  it("prints the code a text resolves to", () => {
    expect(unitCode(index, "Pieces")).toBe("PCS")
  })

  it("keeps an unknown text, upper-cased", () => {
    expect(unitCode(index, " drum ")).toBe("DRUM")
  })
})

describe("matchUnits", () => {
  it.each([
    ["blank", "  ", []],
    ["code, any case", "kg", ["KG"]],
    ["name", "piece", ["PCS"]],
    ["unnamed unit by code", "set", ["SET"]],
    ["trimmed", " pc ", ["PCS", "PCT"]],
    ["alias", "gulung", ["RLS"]],
    ["alias with a dot", "roll.", ["RLS"]],
    ["alias part", "piec", ["PCS"]],
  ])("%s", (_, query, codes) => {
    expect(matchUnits(units, query).map((u) => u.code)).toEqual(codes)
  })

  it("puts an exact code or alias first", () => {
    expect(matchUnits(units, "can").map((u) => u.code)).toEqual(["CAN"])
    expect(matchUnits(units, "meter").map((u) => u.code)).toEqual(["MTR", "M2"])
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

describe("unitOption", () => {
  it.each([
    ["a code hit", units[0], "pcs", "PCS - Piece"],
    ["a name hit", units[0], "piece", "PCS - Piece"],
    ["an alias hit", units[0], "ea", "PCS - Piece (EA)"],
    ["an alias part", units[7], "gul", "RLS - Rolls (GULUNG)"],
    ["no query", units[0], "", "PCS - Piece"],
    ["an unnamed unit", units[2], "x", "SET"],
  ])("labels %s", (_, unit, query, label) => {
    expect(unitOption(unit, query)).toBe(label)
  })
})

describe("retired units", () => {
  it("are never offered by the picker", () => {
    expect(matchUnits(units, "oth")).toEqual([])
    expect(matchUnits(units, "lainnya")).toEqual([])
  })

  it("still resolve, so a stored line keeps its code", () => {
    expect(resolveUnit(unitIndex(units), "OTH")?.id).toBe(11)
  })

  it.each([
    ["no unit kept", "", false],
    ["a current unit kept", "PCS", false],
    ["the retired unit kept", "OTH", true],
  ])("a select offers them only when %s", (_name, kept, offered) => {
    const codes = unitChoices(units, kept)
    expect(codes).toContain("CAN")
    expect(codes.includes("OTH")).toBe(offered)
  })

  it("reads no list as none", () => {
    expect(unitChoices(undefined, "PCS")).toEqual([])
  })
})
