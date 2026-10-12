import { describe, expect, it } from "vitest"
import { readList, writeList } from "@/lib/list-search"
import { CLIENT_FILTERS, clientListSchema, validateClientSearch } from "./list-search"

describe("client list search", () => {
  it("reads a plain URL as the defaults", () => {
    expect(readList(clientListSchema, {}).filters).toEqual(CLIENT_FILTERS)
    expect(validateClientSearch({})).toEqual({})
  })

  it("round-trips every filter", () => {
    const search = { q: "samudra", status: "inactive", country: "SGP", min: "500000", page: 2 }
    const state = readList(clientListSchema, search)
    expect(state.filters).toEqual({ status: "inactive", countryCode: "SGP", minTotal: "500000" })
    expect(writeList(clientListSchema, state)).toEqual(search)
  })

  it("drops malformed values", () => {
    expect(validateClientSearch({ status: "gone", country: "  ", min: "0", per: 100 })).toEqual({})
  })
})
