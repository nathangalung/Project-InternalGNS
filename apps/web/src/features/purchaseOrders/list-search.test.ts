import { describe, expect, it } from "vitest"
import { readList, writeList } from "@/lib/list-search"
import { PO_FILTERS, poListSchema, validatePoSearch } from "./list-search"

describe("purchase order list search", () => {
  it("reads a plain URL as no filter", () => {
    expect(readList(poListSchema, {}).filters).toMatchObject({
      preset: "semua",
      statuses: [],
      minHarga: "",
      maxHarga: "",
    })
    expect(poListSchema.writeFilters(PO_FILTERS)).toEqual({})
    expect(validatePoSearch({})).toEqual({})
  })

  it("round-trips every filter", () => {
    const search = {
      q: "10/2026",
      status: "ON_PROGRESS,DELIVERED",
      preset: "kustom",
      from: "2026-10-01",
      to: "2026-10-31",
      min: "2000000",
      page: 3,
      per: 15,
    } as const
    const state = readList(poListSchema, search)
    expect(state.filters).toEqual({
      preset: "kustom",
      startDate: "2026-10-01",
      endDate: "2026-10-31",
      statuses: ["ON_PROGRESS", "DELIVERED"],
      minHarga: "2000000",
      maxHarga: "",
    })
    expect(writeList(poListSchema, state)).toEqual(search)
  })

  it("drops malformed values and any sort", () => {
    expect(
      validatePoSearch({ status: "SHIPPED", preset: 3, min: "-", sort: "poDate", dir: "asc" }),
    ).toEqual({})
  })
})
