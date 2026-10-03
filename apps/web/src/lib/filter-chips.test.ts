import { describe, expect, it, vi } from "vitest"
import { filterChips } from "./filter-chips"

type F = { status: string; unit: string; min: string }
const defaults: F = { status: "all", unit: "", min: "" }
const labels = {
  status: (v: string) => `Status: ${v === "active" ? "Aktif" : "Nonaktif"}`,
  unit: (v: string) => `Satuan: ${v}`,
}

describe("filterChips", () => {
  it("shows nothing when the search is empty and filters sit on their defaults", () => {
    expect(filterChips({ term: "", clear: vi.fn() }, defaults, defaults, labels, vi.fn())).toEqual(
      [],
    )
  })

  it("lists the search first, then each changed labelled filter in label order", () => {
    const chips = filterChips(
      { term: "baut", clear: vi.fn() },
      { status: "active", unit: "PCS", min: "500" },
      defaults,
      labels,
      vi.fn(),
    )
    expect(chips.map((c) => [c.key, c.label])).toEqual([
      ["q", 'Cari: "baut"'],
      ["status", "Status: Aktif"],
      ["unit", "Satuan: PCS"],
    ])
  })

  it("removes the search with its own clear and a filter by resetting it to its default", () => {
    const clear = vi.fn()
    const patch = vi.fn()
    const chips = filterChips(
      { term: "baut", clear },
      { status: "inactive", unit: "", min: "" },
      defaults,
      labels,
      patch,
    )
    chips[0].onRemove?.()
    expect(clear).toHaveBeenCalledOnce()
    chips[1].onRemove?.()
    const update = patch.mock.calls[0][0] as (p: F) => F
    expect(update({ status: "inactive", unit: "KG", min: "9" })).toEqual({
      status: "all",
      unit: "KG",
      min: "9",
    })
  })
})
