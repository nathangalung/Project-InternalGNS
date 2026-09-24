import { describe, expect, it } from "vitest"
import type { QuotationDetail, QuotationItemRow, QuotationStatusEvent } from "@/types/api"
import {
  historyAction,
  historyDate,
  toEditItemInput,
  toQuotationData,
  toTableRow,
  toWizardProduct,
} from "./adapters"

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
      productCount: 1,
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

describe("edit wizard lines", () => {
  const cases: { name: string; over: Partial<QuotationItemRow>; kode: string; nama: string }[] = [
    {
      name: "offered differs from the request",
      over: {
        requestedImpa: "111",
        requestedName: "Tali",
        offeredImpa: "222",
        offeredName: "Rope 12mm",
      },
      kode: "222",
      nama: "Rope 12mm",
    },
    {
      name: "only an offered name",
      over: { requestedImpa: "111", requestedName: "Tali", offeredName: "Rope 12mm" },
      kode: "111",
      nama: "Rope 12mm",
    },
    {
      name: "no offered fields",
      over: { requestedImpa: "111", requestedName: "Tali" },
      kode: "111",
      nama: "Tali",
    },
  ]

  for (const c of cases) {
    it(`shows the detail's item: ${c.name}`, () => {
      const line = item(c.over)
      const wiz = toWizardProduct(line, 1, "PCS")
      const [row] = toQuotationData(detail([line]), () => "PCS").products
      expect(wiz.kodeImpa).toBe(c.kode)
      expect(wiz.nama).toBe(c.nama)
      expect(row.kode).toBe(wiz.kodeImpa)
      expect(row.nama).toBe(wiz.nama)
      expect(wiz.requestedNama).toBe(c.over.requestedName)
      expect(wiz.requestedKodeImpa).toBe(c.over.requestedImpa)
    })
  }

  it("saves the request as stored", () => {
    const line = item({ requestedImpa: "111", requestedName: "Tali", offeredImpa: "222" })
    const input = toEditItemInput(toWizardProduct(line, 1, "PCS"), 3)
    expect(input.requestedImpa).toBe("111")
    expect(input.requestedName).toBe("Tali")
    expect(input.unitId).toBe(3)
  })

  it("does not print the offered code as a request", () => {
    const line = item({ requestedName: "Tali", offeredImpa: "222", offeredName: "Rope" })
    const input = toEditItemInput(toWizardProduct(line, 1, "PCS"), 3)
    expect(input.requestedImpa).toBeUndefined()
    expect(input.requestedName).toBe("Tali")
  })
})
