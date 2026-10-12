import { describe, expect, it } from "vitest"
import { ApiError } from "@/lib/api-client"
import { problem } from "@/test/problem"
import type { PurchaseOrderItemRow } from "@/types/api"
import { deliveryNoteChanges, deliveryNoteErrors, deliveryNoteRows } from "./deliveryNote"
import { PO_CONFLICT_MESSAGE } from "./helpers"

const line = (over: Partial<PurchaseOrderItemRow>): PurchaseOrderItemRow => ({
  id: 1,
  poId: 7,
  lineNumber: 1,
  itemType: "product",
  itemName: "Tali Tambang",
  qty: "2.50",
  isAvailable: true,
  ...over,
})

describe("deliveryNoteRows", () => {
  it("lists product rows with the saved note, else the default", () => {
    const rows = deliveryNoteRows([
      line({
        id: 1,
        unitCode: "PCS",
        dnNote: "Serahkan ke mualim",
        dnNoteDefault: "Kirim ke: Gudang",
      }),
      line({ id: 2, itemName: "Cat", qty: "1000", dnNoteDefault: "Kirim ke: Gudang Cakung" }),
      line({ id: 3, itemName: "Lampu", qty: "3", dnNote: "" }),
      line({ id: 4, itemType: "shipping", itemName: "Pengiriman" }),
    ])
    expect(rows).toEqual([
      { lineId: 1, name: "Tali Tambang", qty: "2,5", unit: "PCS", note: "Serahkan ke mualim" },
      { lineId: 2, name: "Cat", qty: "1.000", unit: "", note: "Kirim ke: Gudang Cakung" },
      { lineId: 3, name: "Lampu", qty: "3", unit: "", note: "" },
    ])
  })

  it("has no rows before the items load", () => {
    expect(deliveryNoteRows(undefined)).toEqual([])
  })
})

describe("deliveryNoteChanges", () => {
  const rows = deliveryNoteRows([
    line({ id: 1, dnNoteDefault: "Kirim ke: Gudang" }),
    line({ id: 2, dnNote: "Hati hati" }),
  ])

  it("is null when nothing changed", () => {
    expect(deliveryNoteChanges(rows, ["Kirim ke: Gudang", " Hati hati "])).toBeNull()
  })

  it("sends every row once one changed, so the reprint matches the dialog", () => {
    expect(deliveryNoteChanges(rows, ["Kirim ke: Gudang", "Taruh di dek"])).toEqual([
      { lineId: 1, note: "Kirim ke: Gudang" },
      { lineId: 2, note: "Taruh di dek" },
    ])
  })

  it("reads a row with no input as cleared", () => {
    expect(deliveryNoteChanges(rows, ["Kirim ke: Gudang"])).toEqual([
      { lineId: 1, note: "Kirim ke: Gudang" },
      { lineId: 2, note: "" },
    ])
  })

  it("sends a cleared note as empty", () => {
    expect(deliveryNoteChanges(rows, ["  ", "Hati hati"])).toEqual([
      { lineId: 1, note: "" },
      { lineId: 2, note: "Hati hati" },
    ])
  })
})

describe("deliveryNoteErrors", () => {
  it("puts a note's field message on its row", () => {
    const err = new ApiError(
      422,
      problem(422, { fields: { "notes[1].note": "Catatan paling banyak 500 karakter." } }),
      "Unprocessable",
    )
    expect(deliveryNoteErrors(err, 2)).toEqual({
      fields: { "notes[1].note": "Catatan paling banyak 500 karakter." },
      banner: null,
    })
  })

  it("says the page reloaded on a stale version", () => {
    const err = new ApiError(409, problem(409, { code: "version_conflict" }), "Conflict")
    expect(deliveryNoteErrors(err, 1)).toEqual({ fields: {}, banner: PO_CONFLICT_MESSAGE })
  })

  it("keeps the server's lock detail", () => {
    const detail = "Catatan surat jalan hanya bisa diubah saat PO Dalam Progres atau Dikirim."
    const err = new ApiError(409, problem(409, { code: "po_locked", detail }), detail)
    expect(deliveryNoteErrors(err, 1)).toEqual({ fields: {}, banner: detail })
  })

  it("falls back on a network failure", () => {
    expect(deliveryNoteErrors(new TypeError("fetch failed"), 1)).toEqual({
      fields: {},
      banner: "Gagal menyimpan catatan surat jalan.",
    })
  })
})
