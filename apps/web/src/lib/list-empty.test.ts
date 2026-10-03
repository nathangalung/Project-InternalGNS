import { describe, expect, it } from "vitest"
import { emptyListText } from "./list-empty"

describe("emptyListText", () => {
  const empty = "Belum ada Quotation."

  it("names the search term when one is typed", () => {
    expect(emptyListText({ debouncedSearch: "baut", narrowed: true }, empty)).toBe(
      'Tidak ada hasil untuk "baut".',
    )
  })

  it("points at the filters when only they narrow the list", () => {
    expect(emptyListText({ debouncedSearch: "", narrowed: true }, empty)).toBe(
      "Tidak ada hasil untuk filter ini.",
    )
  })

  it("keeps the list's own text when nothing narrows it", () => {
    expect(emptyListText({ debouncedSearch: "", narrowed: false }, empty)).toBe(empty)
  })
})
