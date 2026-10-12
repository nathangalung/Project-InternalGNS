import { describe, expect, it } from "vitest"
import { readList, writeList } from "@/lib/list-search"
import { USER_FILTERS, userListSchema, validateUserSearch } from "./list-search"

describe("user list search", () => {
  it("reads a plain URL as the defaults, newest first", () => {
    expect(readList(userListSchema, {})).toMatchObject({
      filters: USER_FILTERS,
      sort: { key: "createdAt", dir: "desc" },
    })
    expect(validateUserSearch({})).toEqual({})
  })

  it("round-trips every filter and the sort", () => {
    const search = {
      q: "budi",
      role: "finance_input",
      status: "active",
      sort: "name",
      dir: "asc",
    } as const
    const state = readList(userListSchema, search)
    expect(state.filters).toEqual({ role: "finance_input", status: "active" })
    expect(writeList(userListSchema, state)).toEqual(search)
  })

  it("leaves the default sort out", () => {
    expect(validateUserSearch({ sort: "createdAt", dir: "desc" })).toEqual({})
  })

  it("drops malformed values", () => {
    expect(validateUserSearch({ role: "admin", status: "all", sort: "email" })).toEqual({})
  })
})
