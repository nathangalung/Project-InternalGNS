import { describe, expect, it } from "vitest"
import { readList, writeList } from "@/lib/list-search"
import { CASH_FILTERS } from "./helpers"
import { cashListSchema, validateCashSearch } from "./list-search"

describe("cash entry list search", () => {
  it("reads a plain URL as the defaults", () => {
    expect(readList(cashListSchema, {}).filters).toEqual(CASH_FILTERS)
    expect(validateCashSearch({})).toEqual({})
  })

  it("round-trips every filter", () => {
    const search = {
      q: "modal",
      direction: "in",
      category: "Pinjaman",
      from: "2026-01-01",
      to: "2026-12-31",
      page: 2,
    } as const
    const state = readList(cashListSchema, search)
    expect(state.filters).toEqual({
      direction: "in",
      category: "Pinjaman",
      dateFrom: "2026-01-01",
      dateTo: "2026-12-31",
    })
    expect(writeList(cashListSchema, state)).toEqual(search)
  })

  it("drops malformed values", () => {
    expect(
      validateCashSearch({ direction: "both", category: "", from: "1/1/2026", to: 2026 }),
    ).toEqual({})
  })
})
