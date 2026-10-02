import { describe, expect, it } from "vitest"
import type { InvoiceBackendRow } from "@/types/api"
import type { InvoiceFilterValues } from "./InvoiceFilter"
import { detailSearch, invoiceListParams, rowFromBackend } from "./list"

function invoice(over: Partial<InvoiceBackendRow> = {}): InvoiceBackendRow {
  const status = over.status ?? "sent"
  return {
    id: 3,
    invoiceNo: "INV-3",
    quotationId: 103,
    quotationNo: "Q-3",
    companyClientId: 9,
    companyName: "PT Laut",
    invoiceDate: "2026-09-01",
    dueDate: "2026-10-01",
    total: "2000000",
    status,
    effectiveStatus: status,
    rowVersion: 1,
    createdAt: "2026-09-01T03:00:00Z",
    ...over,
  } as InvoiceBackendRow
}

const noFilter: InvoiceFilterValues = {
  createdPreset: "semua",
  createdStart: "",
  createdEnd: "",
  duePreset: "semua",
  dueStart: "",
  dueEnd: "",
  statuses: [],
  minHarga: "",
  maxHarga: "",
}

describe("invoiceListParams", () => {
  it("leaves cancelled out by default", () => {
    expect(invoiceListParams("", null, 10, 20)).toEqual({
      q: undefined,
      limit: 10,
      offset: 20,
      sortBy: "createdAt",
      sortDir: "desc",
      effectiveStatus: "draft,sent,paid,overdue",
    })
    expect(invoiceListParams("", noFilter, 10, 0).effectiveStatus).toBe("draft,sent,paid,overdue")
  })

  it("lists cancelled only when Dibatalkan is picked", () => {
    const f = { ...noFilter, statuses: ["DIBATALKAN", "TERLAMBAT"] as const }
    expect(invoiceListParams("INV", { ...f, statuses: [...f.statuses] }, 10, 0)).toMatchObject({
      q: "INV",
      effectiveStatus: "cancelled,overdue",
    })
  })

  it("sends the date windows and the total band", () => {
    const p = invoiceListParams(
      "",
      {
        ...noFilter,
        createdPreset: "kustom",
        createdStart: "2026-09-01",
        createdEnd: "2026-09-30",
        duePreset: "kustom",
        dueStart: "2026-10-01",
        dueEnd: "2026-10-31",
        minHarga: "Rp 1.000",
        maxHarga: "0",
      },
      10,
      0,
    )
    expect(p).toMatchObject({
      dateFrom: "2026-09-01",
      dateTo: "2026-09-30",
      dueFrom: "2026-10-01",
      dueTo: "2026-10-31",
      minTotal: "1000",
    })
    expect(p.maxTotal).toBeUndefined()
  })

  it("sends a maximum total", () => {
    expect(invoiceListParams("", { ...noFilter, maxHarga: "5.000" }, 10, 0).maxTotal).toBe("5000")
  })
})

describe("rowFromBackend", () => {
  it("maps the display fields", () => {
    expect(rowFromBackend(invoice())).toEqual({
      id: 3,
      quotationId: 103,
      companyClientId: 9,
      invoiceNo: "INV-3",
      client: "PT Laut",
      createdAt: "2026-09-01",
      dueDate: "2026-10-01",
      total: "Rp2.000.000",
      totalNumber: 2000000,
      status: "DIKIRIM",
    })
  })

  it.each<[string, Partial<InvoiceBackendRow>, string]>([
    ["a cancelled invoice reads Dibatalkan", { status: "cancelled" }, "DIBATALKAN"],
    [
      "a sent invoice past due reads Terlambat",
      { status: "sent", effectiveStatus: "overdue" },
      "TERLAMBAT",
    ],
  ])("%s", (_name, over, want) => {
    expect(rowFromBackend(invoice(over)).status).toBe(want)
  })

  it("falls back to the subtotal, the invoice date and zero", () => {
    const row = rowFromBackend(
      invoice({
        total: undefined,
        subtotal: "abc",
        dueDate: undefined,
      } as Partial<InvoiceBackendRow>),
    )
    expect(row).toMatchObject({ totalNumber: 0, dueDate: "2026-09-01" })
  })
})

describe("detailSearch", () => {
  // The quotation route opens the newest.
  it("names a cancelled invoice, which a Pengganti may have replaced", () => {
    expect(detailSearch(rowFromBackend(invoice({ status: "cancelled" })))).toEqual({ invoiceId: 3 })
    expect(detailSearch(rowFromBackend(invoice()))).toEqual({})
  })
})
