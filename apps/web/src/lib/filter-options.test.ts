import { describe, expect, it } from "vitest"
import { STATUS_FILTER_OPTIONS } from "./filter-options"

describe("STATUS_FILTER_OPTIONS", () => {
  it("lists every status once, Semua first, in Indonesian", () => {
    expect(STATUS_FILTER_OPTIONS).toEqual([
      { value: "all", label: "Semua" },
      { value: "active", label: "Aktif" },
      { value: "inactive", label: "Nonaktif" },
    ])
  })
})
