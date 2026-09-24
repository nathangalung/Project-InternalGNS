import { describe, expect, it } from "vitest"
import { ApiError } from "@/lib/api-client"
import type { AdvancedSearchHit, AdvancedSearchResponse, AdvancedSearchTier } from "@/types/api"
import {
  addVendorError,
  apiFieldError,
  findVendorByName,
  KATALOG_UNIT_SCAN_LIMIT,
  katalogRowsFromHits,
  katalogSearchPlan,
  katalogSearchView,
  productInitials,
  vendorInitials,
} from "./helpers"

// Hit fixture builder.
function hit(id: number, defaultUnitId?: number, tier: AdvancedSearchTier = "ITEM_AUTO") {
  return {
    id,
    name: `Item ${id}`,
    impaCode: String(100000 + id),
    defaultUnitId,
    isActive: id % 2 === 0,
    score: 0.9,
    tier,
    tiers: [tier],
  } satisfies AdvancedSearchHit
}

// Response fixture builder.
function resp(hits: AdvancedSearchHit[], total: number): AdvancedSearchResponse {
  return { query: "q", total, hits, counts: { ITEM_AUTO: total } }
}

describe("katalogRowsFromHits", () => {
  it("keeps only table fields", () => {
    expect(katalogRowsFromHits([hit(1, 7), hit(2)])).toEqual([
      { id: 1, name: "Item 1", impaCode: "100001", defaultUnitId: 7, isActive: false },
      { id: 2, name: "Item 2", impaCode: "100002", defaultUnitId: undefined, isActive: true },
    ])
  })
})

describe("katalogSearchPlan", () => {
  it.each([
    ["page 1, no unit", undefined, 0, 10, { limit: 10, offset: 0, clientPage: false }],
    ["page 3, no unit", undefined, 30, 15, { limit: 15, offset: 30, clientPage: false }],
    ["unit, page 1", 8, 0, 10, { limit: 200, offset: 0, clientPage: true }],
    ["unit, page 4", 8, 30, 10, { limit: 200, offset: 0, clientPage: true }],
  ])("%s", (_name, unitId, startIndex, perPage, want) => {
    expect(katalogSearchPlan(unitId, startIndex, perPage)).toEqual(want)
  })

  it("scans at the server clamp", () => {
    expect(KATALOG_UNIT_SCAN_LIMIT).toBe(200)
  })
})

describe("katalogSearchView", () => {
  const server = katalogSearchPlan(undefined, 10, 10)
  const scan = katalogSearchPlan(8, 0, 2)

  it("is empty before data", () => {
    expect(katalogSearchView(undefined, server, undefined, 10, 10)).toEqual({
      hits: [],
      total: 0,
      counts: {},
      capped: false,
    })
  })

  it("takes a server page as is", () => {
    const data = resp([hit(11), hit(12)], 251)
    const view = katalogSearchView(data, server, undefined, 10, 10)
    expect(view.hits.map((h) => h.id)).toEqual([11, 12])
    expect(view.total).toBe(251)
    expect(view.counts).toEqual({ ITEM_AUTO: 251 })
    expect(view.capped).toBe(false)
  })

  const scanned = [
    hit(1, 8, "ITEM_AUTO"),
    hit(2, 7),
    hit(3, 8, "VENDOR_OFFER"),
    hit(4, 8, "ITEM_FUZZY"),
    hit(5),
  ]

  it.each([
    ["page 1", 0, [1, 3]],
    ["page 2", 2, [4]],
    ["past the end", 4, []],
  ])("filters and pages the scan: %s", (_name, startIndex, want) => {
    const view = katalogSearchView(resp(scanned, 5), scan, 8, startIndex, 2)
    expect(view.hits.map((h) => h.id)).toEqual(want)
    expect(view.total).toBe(3)
  })

  it("counts tiers over the filtered scan", () => {
    expect(katalogSearchView(resp(scanned, 5), scan, 8, 0, 2).counts).toEqual({
      ITEM_AUTO: 1,
      VENDOR_OFFER: 1,
      ITEM_FUZZY: 1,
    })
  })

  it.each([
    ["whole match set read", 5, false],
    ["more matches than the scan", 251, true],
  ])("capped: %s", (_name, total, want) => {
    expect(katalogSearchView(resp(scanned, total), scan, 8, 0, 2).capped).toBe(want)
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
