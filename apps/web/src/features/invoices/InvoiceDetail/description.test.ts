import { describe, expect, it } from "vitest"
import { ApiError } from "@/lib/api-client"
import { problem } from "@/test/problem"
import type { InvoiceItemRow } from "@/types/api"
import {
  DESCRIPTION_CONFLICT_MESSAGE,
  descriptionChanges,
  descriptionErrors,
  descriptionRows,
  descriptionsEditable,
} from "./description"

const line = (over: Partial<InvoiceItemRow>): InvoiceItemRow => ({
  id: 1,
  invoiceId: 7,
  lineType: "product",
  itemName: "Tali Tambang",
  qty: "2.50",
  unitPrice: "1000",
  ...over,
})

describe("descriptionRows", () => {
  it("lists every printed line with its saved text, else its destination", () => {
    const rows = descriptionRows([
      line({ id: 1, itemCode: "790269", unitCode: "PCS", description: "Warna abu abu" }),
      line({ id: 2, itemName: "Cat", qty: "1000", shipDestination: "Gudang Cakung" }),
      line({ id: 3, itemName: "Lampu", qty: "3", shipDestination: "Gudang", description: "" }),
      line({ id: 4, lineType: "shipping", itemName: "Pengiriman", qty: "1" }),
    ])
    expect(rows).toEqual([
      {
        lineId: 1,
        name: "790269 - Tali Tambang",
        qty: "2,5",
        unit: "PCS",
        description: "Warna abu abu",
      },
      { lineId: 2, name: "Cat", qty: "1.000", unit: "", description: "Gudang Cakung" },
      { lineId: 3, name: "Lampu", qty: "3", unit: "", description: "" },
      { lineId: 4, name: "Pengiriman", qty: "1", unit: "", description: "" },
    ])
  })

  it("has no rows before the lines load", () => {
    expect(descriptionRows(undefined)).toEqual([])
  })
})

describe("descriptionChanges", () => {
  const rows = descriptionRows([
    line({ id: 1, shipDestination: "Gudang" }),
    line({ id: 2, description: "Hati hati" }),
  ])

  it("is null when nothing changed", () => {
    expect(descriptionChanges(rows, ["Gudang", " Hati hati "])).toBeNull()
  })

  it("sends every row once one changed, so the reprint matches the dialog", () => {
    expect(descriptionChanges(rows, ["Gudang", "Taruh di dek"])).toEqual([
      { lineId: 1, description: "Gudang" },
      { lineId: 2, description: "Taruh di dek" },
    ])
  })

  it("sends a cleared row as empty", () => {
    expect(descriptionChanges(rows, ["  "])).toEqual([
      { lineId: 1, description: "" },
      { lineId: 2, description: "" },
    ])
  })
})

describe("descriptionsEditable", () => {
  it.each([
    ["draft", true],
    ["sent", true],
    ["overdue", true],
    ["paid", false],
    ["cancelled", false],
  ] as const)("%s is %s", (status, want) => {
    expect(descriptionsEditable(status)).toBe(want)
  })
})

describe("descriptionErrors", () => {
  it("puts a row's field message on its row", () => {
    const err = new ApiError(
      422,
      problem(422, { fields: { "lines[1].description": "Deskripsi paling banyak 500 karakter." } }),
      "Unprocessable",
    )
    expect(descriptionErrors(err, 2)).toEqual({
      fields: { "lines[1].description": "Deskripsi paling banyak 500 karakter." },
      banner: null,
    })
  })

  it("says the invoice changed on a stale version", () => {
    const err = new ApiError(409, problem(409, { code: "version_conflict" }), "Conflict")
    expect(descriptionErrors(err, 1)).toEqual({
      fields: {},
      banner: DESCRIPTION_CONFLICT_MESSAGE,
    })
  })

  it("keeps the server's reason for a filed invoice", () => {
    const detail = "Deskripsi invoice yang sudah lunas atau dibatalkan tidak dapat diubah."
    const err = new ApiError(409, problem(409, { detail }), detail)
    expect(descriptionErrors(err, 1)).toEqual({ fields: {}, banner: detail })
  })

  it("falls back on a network failure", () => {
    expect(descriptionErrors(new TypeError("fetch failed"), 1)).toEqual({
      fields: {},
      banner: "Gagal menyimpan deskripsi invoice.",
    })
  })
})
