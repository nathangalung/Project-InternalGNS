import { describe, expect, it } from "vitest"
import { readList, writeList } from "@/lib/list-search"
import { INVOICE_FILTERS, invoiceListSchema, validateInvoiceSearch } from "./list-search"

describe("invoice list search", () => {
  it("reads a plain URL as no filter", () => {
    expect(readList(invoiceListSchema, {}).filters).toMatchObject({
      createdPreset: "semua",
      duePreset: "semua",
      statuses: [],
      minHarga: "",
      maxHarga: "",
    })
    expect(invoiceListSchema.writeFilters(INVOICE_FILTERS)).toEqual({})
    expect(validateInvoiceSearch({})).toEqual({})
  })

  it("reads statuses by their API key", () => {
    const { filters } = readList(invoiceListSchema, { status: "cancelled,overdue,lost" })
    expect(filters.statuses).toEqual(["DIBATALKAN", "TERLAMBAT"])
  })

  it("round-trips every filter", () => {
    const search = {
      q: "X/2026",
      status: "paid",
      created: "kustom",
      createdFrom: "2026-01-01",
      createdTo: "2026-06-30",
      due: "30-hari",
      min: "100",
      max: "900",
      page: 2,
    } as const
    const state = readList(invoiceListSchema, search)
    expect(state.filters).toMatchObject({
      createdPreset: "kustom",
      createdStart: "2026-01-01",
      createdEnd: "2026-06-30",
      duePreset: "30-hari",
      statuses: ["DIBAYAR"],
      minHarga: "100",
      maxHarga: "900",
    })
    expect(writeList(invoiceListSchema, state)).toEqual(search)
  })

  it("drops malformed values", () => {
    expect(
      validateInvoiceSearch({
        status: "DIBAYAR",
        created: "kustom",
        createdFrom: "2026-13-01",
        due: "minggu",
        dueTo: "2026-01-01",
        max: "Rp",
      }),
    ).toEqual({})
  })
})
