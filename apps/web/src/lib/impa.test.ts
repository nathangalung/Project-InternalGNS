import { describe, expect, it } from "vitest"
import { IMPA_ERROR, impaCodeError, impaLabel, normalizeImpa } from "./impa"

type ImpaCase = { input: string; code: string; valid: boolean; note?: string }

type ImpaTable = { message: string; cases: ImpaCase[] }

// The API's IMPA table, read by glob as validation.test.ts reads its own.
const tables = import.meta.glob<ImpaTable>(
  "../../../api/internal/shared/validate/testdata/impa_rules.json",
  { eager: true, import: "default" },
)
const table = Object.values(tables)[0]

describe("shared IMPA table", () => {
  it("is found with the same message", () => {
    expect(Object.keys(tables)).toHaveLength(1)
    expect(IMPA_ERROR).toBe(table.message)
  })

  it.each(table.cases)("$input -> $code", ({ input, code, valid }) => {
    expect(normalizeImpa(input)).toBe(code)
    expect(impaCodeError(input)).toBe(valid ? null : IMPA_ERROR)
  })
})

describe("impaLabel", () => {
  it.each<[string | null | undefined, string]>([
    ["190105", "190105"],
    ["", "-"],
    ["  ", "-"],
    [null, "-"],
    [undefined, "-"],
  ])("%j -> %j", (code, want) => {
    expect(impaLabel(code)).toBe(want)
  })
})
