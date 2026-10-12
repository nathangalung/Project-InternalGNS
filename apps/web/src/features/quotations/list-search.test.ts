import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readList, writeList } from "@/lib/list-search"
import { QUOTATION_FILTERS, quotationListSchema, validateQuotationSearch } from "./list-search"

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date("2026-10-12T03:00:00Z"))
})
afterEach(() => vi.useRealTimers())

describe("quotation list search", () => {
  it("reads a plain URL as no filter", () => {
    expect(readList(quotationListSchema, {})).toMatchObject({
      filters: { preset: "semua", statuses: [], minHarga: "", maxHarga: "" },
      sort: null,
    })
    expect(writeList(quotationListSchema, readList(quotationListSchema, {}))).toEqual({})
    expect(quotationListSchema.writeFilters(QUOTATION_FILTERS)).toEqual({})
    expect(validateQuotationSearch({})).toEqual({})
  })

  it("reads statuses by key and shows them by label", () => {
    const { filters } = readList(quotationListSchema, { status: "sent,draft,zz" })
    expect(filters.statuses).toEqual(["Dikirim", "Draf"])
  })

  it("round-trips every filter and the sort", () => {
    const search = {
      q: "X/2026",
      status: "accepted",
      preset: "kustom",
      from: "2026-01-01",
      to: "2026-03-31",
      min: "1000000",
      max: "5000000",
      sort: "total",
      dir: "desc",
      page: 2,
    } as const
    const state = readList(quotationListSchema, search)
    expect(state.filters).toEqual({
      preset: "kustom",
      startDate: "2026-01-01",
      endDate: "2026-03-31",
      statuses: ["Disetujui"],
      minHarga: "1000000",
      maxHarga: "5000000",
    })
    expect(writeList(quotationListSchema, state)).toEqual(search)
  })

  it("writes a preset without its days", () => {
    const state = readList(quotationListSchema, { preset: "7-hari", from: "2026-01-01" })
    expect(state.filters).toMatchObject({ startDate: "2026-10-05", endDate: "2026-10-12" })
    expect(validateQuotationSearch({ preset: "7-hari", from: "2026-01-01" })).toEqual({
      preset: "7-hari",
    })
  })

  it("drops malformed values", () => {
    expect(
      validateQuotationSearch({
        status: "lost",
        preset: "besok",
        from: "kemarin",
        min: "abc",
        max: 0,
        sort: "client",
        page: -1,
        per: "x",
      }),
    ).toEqual({})
  })
})
