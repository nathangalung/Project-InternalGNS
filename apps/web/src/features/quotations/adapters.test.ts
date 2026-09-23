import { describe, expect, it } from "vitest"
import type { QuotationDetail, QuotationItemRow, QuotationStatusEvent } from "@/types/api"
import { historyAction, historyDate, toQuotationData, toTableRow } from "./adapters"

function item(over: Partial<QuotationItemRow>): QuotationItemRow {
  return {
    id: 1,
    quotationId: 7,
    lineNumber: 1,
    itemType: "product",
    requestedName: "Rope",
    qty: "2",
    sellingPrice: "100",
    costPrice: "60",
    discountPct: "0",
    totalSelling: "200",
    discountAmount: "0",
    subtotal: "200",
    isAvailable: true,
    ...over,
  }
}

function detail(items: QuotationItemRow[]): QuotationDetail {
  return {
    id: 7,
    quotationNo: "Q-7",
    version: 1,
    companyClientId: 42,
    companyClientName: "PT Laut",
    status: "draft",
    discountPct: "0",
    totalProduk: "200",
    total: "200",
    totalDiscount: "0",
    subtotal: "200",
    dppNilaiLain: "183",
    ppnAmount: "22",
    grandTotal: "222",
    rowVersion: 1,
    createdAt: "2026-09-01T00:00:00Z",
    updatedAt: "2026-09-01T00:00:00Z",
    items,
    history: [],
    allowedTransitions: [],
    canRevise: false,
  }
}

function event(over: Partial<QuotationStatusEvent>): QuotationStatusEvent {
  return { id: 1, toStatus: "draft", changedBy: 1, changedAt: "2026-09-01T00:00:00Z", ...over }
}

describe("toQuotationData link ids", () => {
  it("carries the client id", () => {
    expect(toQuotationData(detail([]), () => "").clientId).toBe(42)
  })

  it("prefers the offered item over the requested one", () => {
    const rows = toQuotationData(
      detail([
        item({ id: 11, offeredItemId: 5, requestedItemId: 9 }),
        item({ id: 12, requestedItemId: 9 }),
        item({ id: 13 }),
      ]),
      () => "PCS",
    ).products
    expect(rows.map((r) => r.itemId)).toEqual([5, 9, undefined])
    expect(rows.map((r) => r.lineId)).toEqual([11, 12, 13])
  })

  it("leaves shipping out of the product rows", () => {
    const rows = toQuotationData(
      detail([item({ id: 1 }), item({ id: 2, itemType: "shipping", offeredItemId: 3 })]),
      () => "",
    ).products
    expect(rows).toHaveLength(1)
  })
})

describe("historyAction wording", () => {
  it("names the creation status", () => {
    expect(historyAction(event({ note: "Quotation dibuat" }))).toBe("Dibuat sebagai Draf")
  })

  it("shows the transition and its note", () => {
    expect(historyAction(event({ fromStatus: "sent", toStatus: "revision", note: "harga" }))).toBe(
      "Dikirim → Revisi: harga",
    )
  })

  it("omits an empty note", () => {
    expect(historyAction(event({ fromStatus: "draft", toStatus: "sent" }))).toBe("Draf → Dikirim")
  })

  it("does not repeat Kedaluwarsa for the expiry job", () => {
    const note = "Kedaluwarsa otomatis: masa berlaku 7 hari sejak 01-03-2026 telah lewat."
    expect(historyAction(event({ fromStatus: "sent", toStatus: "expired", note }))).toBe(
      "Dikirim → Kedaluwarsa: masa berlaku 7 hari sejak 01-03-2026 telah lewat.",
    )
  })
})

describe("toQuotationData offered item", () => {
  it("shows the offered name and IMPA, keeping the request", () => {
    const [row] = toQuotationData(
      detail([
        item({
          requestedName: "Tali 12mm",
          requestedImpa: "111",
          offeredItemId: 5,
          offeredName: "Rope Nylon 12mm",
          offeredImpa: "211001",
        }),
      ]),
      () => "",
    ).products
    expect(row.nama).toBe("Rope Nylon 12mm")
    expect(row.kode).toBe("211001")
    expect(row.requestedNama).toBe("Tali 12mm")
    expect(row.requestedKode).toBe("111")
  })

  it("falls back to the request without an offer", () => {
    const [row] = toQuotationData(detail([item({ requestedImpa: "111" })]), () => "").products
    expect(row.nama).toBe("Rope")
    expect(row.kode).toBe("111")
  })
})

describe("status labels", () => {
  it("labels a cancelled quotation", () => {
    const d = { ...detail([]), status: "cancelled" as const }
    expect(toQuotationData(d, () => "").status).toBe("Dibatalkan")
  })

  it("spells expired Kedaluwarsa in the table", () => {
    const row = toTableRow({
      id: 1,
      quotationNo: "Q-1",
      version: 1,
      companyName: "PT Laut",
      status: "expired",
      grandTotal: "10",
      subtotal: "10",
      totalDiscount: "0",
      totalHargaBeli: "5",
      createdAt: "2026-09-01T00:00:00Z",
    })
    expect(row.status).toBe("Kedaluwarsa")
  })
})

describe("historyDate actor", () => {
  it("marks the expiry job as Sistem", () => {
    expect(historyDate(event({ changedBy: null }))).toMatch(/· Sistem$/)
  })

  it("leaves a user move unmarked", () => {
    expect(historyDate(event({ changedBy: 1 }))).not.toMatch(/Sistem/)
  })
})
