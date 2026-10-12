import { describe, expect, it } from "vitest"
import { readList, writeList } from "@/lib/list-search"
import {
  VENDOR_FILTERS,
  validateVendorItemsSearch,
  validateVendorSearch,
  vendorItemsSchema,
  vendorListSchema,
} from "./list-search"

describe("vendor list search", () => {
  it("reads a plain URL as the defaults", () => {
    expect(readList(vendorListSchema, {})).toMatchObject({ filters: VENDOR_FILTERS, sort: null })
    expect(validateVendorSearch({})).toEqual({})
  })

  it("round-trips every filter and the sort", () => {
    const search = {
      q: "maju",
      status: "active",
      location: "Batam",
      min: "750000",
      sort: "productCount",
      dir: "desc",
      per: 5,
    } as const
    const state = readList(vendorListSchema, search)
    expect(state.filters).toEqual({ status: "active", countryName: "Batam", minTotal: "750000" })
    expect(state.sort).toEqual({ key: "productCount", dir: "desc" })
    expect(writeList(vendorListSchema, state)).toEqual(search)
  })

  it("drops malformed values", () => {
    expect(validateVendorSearch({ status: 1, location: [], min: "x", sort: "name" })).toEqual({})
  })
})

describe("vendor items search", () => {
  it("keeps only the page and its size", () => {
    expect(validateVendorItemsSearch({ page: "2", per: "5", q: "baut", status: "active" })).toEqual(
      { page: 2, per: 5 },
    )
    expect(readList(vendorItemsSchema, {}).filters).toEqual({})
    expect(writeList(vendorItemsSchema, readList(vendorItemsSchema, { page: 3 }))).toEqual({
      page: 3,
    })
  })
})
