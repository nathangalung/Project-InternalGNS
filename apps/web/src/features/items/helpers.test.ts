import { describe, expect, it } from "vitest"
import { ApiError } from "@/lib/api-client"
import type { AdvancedSearchHit } from "@/types/api"
import {
  addVendorError,
  apiFieldError,
  findVendorByName,
  isSearchCapped,
  KATALOG_SEARCH_LIMIT,
  katalogRowsFromHits,
  productInitials,
  vendorInitials,
} from "./helpers"

// Hit fixture builder.
function hit(id: number, defaultUnitId?: number): AdvancedSearchHit {
  return {
    id,
    name: `Item ${id}`,
    impaCode: String(100000 + id),
    defaultUnitId,
    isActive: id % 2 === 0,
    score: 0.9,
    tier: "ITEM_AUTO",
    tiers: ["ITEM_AUTO"],
  }
}

describe("isSearchCapped", () => {
  it.each([
    [0, KATALOG_SEARCH_LIMIT, false],
    [199, 200, false],
    [200, 200, true],
    [5, 0, false],
  ])("%i hits of %i -> %s", (hits, limit, want) => {
    expect(isSearchCapped(hits, limit)).toBe(want)
  })

  it("asks for the server clamp", () => {
    expect(KATALOG_SEARCH_LIMIT).toBe(200)
  })
})

describe("katalogRowsFromHits", () => {
  const hits = [hit(1, 7), hit(2, 8), hit(3)]

  it("keeps only table fields", () => {
    expect(katalogRowsFromHits(hits)[0]).toEqual({
      id: 1,
      name: "Item 1",
      impaCode: "100001",
      defaultUnitId: 7,
      isActive: false,
    })
  })

  it.each([
    ["no unit filter", undefined, [1, 2, 3]],
    ["unit 8", 8, [2]],
    ["unknown unit", 99, []],
  ])("%s", (_name, unitId, want) => {
    expect(katalogRowsFromHits(hits, unitId).map((r) => r.id)).toEqual(want)
  })
})

describe("initials", () => {
  it.each([
    ["", "?"],
    ["  ", "?"],
    ["kabel", "KA"],
    ["kabel listrik tembaga", "KL"],
  ])("product %j -> %s", (name, want) => {
    expect(productInitials(name)).toBe(want)
  })

  it.each([
    ["PT. Sinar Jaya", "SJ"],
    ["pt Maju", "M"],
    ["Toko Besi Abadi", "TB"],
    ["", "?"],
  ])("vendor %j -> %s", (name, want) => {
    expect(vendorInitials(name)).toBe(want)
  })
})

describe("apiFieldError", () => {
  const inactive = "Vendor sudah nonaktif. Aktifkan vendor itu atau pilih vendor lain."

  it.each([
    ["422 field", new ApiError(422, { fields: { vendorId: inactive } }, inactive), inactive],
    ["other field", new ApiError(422, { fields: { name: "x" } }, "x"), undefined],
    ["blank value", new ApiError(422, { fields: { vendorId: "  " } }, ""), undefined],
    ["no body", new ApiError(500, null, "boom"), undefined],
    ["plain error", new Error("x"), undefined],
  ])("%s", (_name, err, want) => {
    expect(apiFieldError(err, "vendorId")).toBe(want)
  })
})

describe("addVendorError", () => {
  it("puts an inactive vendor on the field", () => {
    const msg = "Vendor sudah nonaktif."
    expect(addVendorError(new ApiError(422, { fields: { vendorId: msg } }, msg))).toEqual({
      field: msg,
    })
  })

  it("puts an unknown vendor on the field", () => {
    expect(
      addVendorError(new ApiError(404, { detail: "vendor not found" }, "vendor not found")),
    ).toEqual({ field: "Vendor tidak ditemukan. Pilih vendor lain." })
  })

  it.each([
    [
      "api detail",
      new ApiError(409, { detail: "Sudah terkait." }, "Sudah terkait."),
      "Sudah terkait.",
    ],
    ["empty message", new ApiError(500, null, ""), "Gagal menambah vendor."],
    ["unknown value", "nope", "Gagal menambah vendor."],
  ])("form error: %s", (_name, err, want) => {
    expect(addVendorError(err)).toEqual({ form: want })
  })
})

describe("findVendorByName", () => {
  const rows = [
    { id: 1, name: "PT Sinar Jaya" },
    { id: 2, name: "Toko Abadi " },
  ]

  it.each([
    ["exact", "PT Sinar Jaya", 1],
    ["case and spaces", "  pt sinar JAYA ", 1],
    ["trailing stored space", "toko abadi", 2],
    ["prefix only", "PT Sinar", undefined],
    ["blank", "  ", undefined],
  ])("%s", (_name, query, want) => {
    expect(findVendorByName(rows, query)?.id).toBe(want)
  })
})
