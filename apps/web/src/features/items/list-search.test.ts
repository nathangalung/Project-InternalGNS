import { describe, expect, it } from "vitest"
import { readList, writeList } from "@/lib/list-search"
import { PRODUCT_FILTERS, productListSchema, validateProductSearch } from "./list-search"

describe("product list search", () => {
  it("reads a plain URL as the defaults", () => {
    expect(readList(productListSchema, {}).filters).toEqual(PRODUCT_FILTERS)
    expect(validateProductSearch({})).toEqual({})
  })

  it("round-trips every filter", () => {
    const search = { q: "tali tambat", status: "active", unit: "PCS", page: 4 }
    const state = readList(productListSchema, search)
    expect(state.filters).toEqual({ status: "active", unitCode: "PCS" })
    expect(writeList(productListSchema, state)).toEqual(search)
  })

  it("drops malformed values", () => {
    expect(validateProductSearch({ status: "all", unit: { code: "PCS" }, page: "0" })).toEqual({})
  })
})
