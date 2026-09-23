import { describe, expect, it } from "vitest"
import { formatRupiah } from "@/lib/format"
import type { PurchaseOrderItemRow, PurchaseOrderRow } from "@/types/api"
import {
  detailsChanged,
  linesMissingUnit,
  lineToInput,
  type PoEditLine,
  poHistoryEntry,
  poItemsToProducts,
  poLinesToEdit,
  poRowFromBackend,
} from "./adapters"

const line = (over: Partial<PurchaseOrderItemRow>): PurchaseOrderItemRow => ({
  id: 1,
  poId: 9,
  lineNumber: 1,
  itemType: "product",
  itemName: "Rope",
  qty: "2.00",
  sellingPrice: "100.00",
  subtotal: "200.00",
  totalSelling: "200.00",
  isAvailable: true,
  ...over,
})

const units = new Map([
  ["PCS", 1],
  ["MTR", 2],
])

describe("poItemsToProducts", () => {
  it("keeps the offered item and vendor for links", () => {
    const rows = poItemsToProducts([
      line({ offeredItemId: 42, vendorId: 7, vendorName: "PT Laut" }),
      line({ id: 2 }),
    ])
    expect(rows.map((r) => [r.itemId, r.vendorId, r.vendor])).toEqual([
      [42, 7, "PT Laut"],
      [undefined, undefined, undefined],
    ])
  })

  it("skips the shipping line", () => {
    expect(poItemsToProducts([line({ itemType: "shipping" })])).toEqual([])
  })
})

describe("poRowFromBackend", () => {
  const po = {
    id: 28,
    quotationId: 549,
    quotationNo: "Q-1/GNS/IX/2026",
    poNumber: "PO-77",
    poDate: "2026-09-01T00:00:00+07:00",
    companyClientId: 4,
    companyName: "PT Samudra",
    status: "ON_PROGRESS",
    quotationTotal: "999000.00",
    poGrandTotal: "799200.00",
    rowVersion: 3,
    deliveryNoteNumber: "DN-1/GNS/IX/2026",
  } as PurchaseOrderRow

  it("shows the PO total, not the quotation total", () => {
    const row = poRowFromBackend(po)
    expect(row.total).toBe(formatRupiah("799200.00"))
    expect(row.poDate).toBe("2026-09-01")
    expect(row.rowVersion).toBe(3)
    expect(row.deliveryNoteNumber).toBe("DN-1/GNS/IX/2026")
    expect(row.companyClientId).toBe(4)
  })
})

describe("detailsChanged", () => {
  const row = { poNumber: "PO-77", poDate: "2026-09-01" }

  it.each([
    [{ poNumber: "PO-77", poDate: "2026-09-01" }, false],
    [{ poNumber: " PO-77 ", poDate: "2026-09-01" }, false],
    [{ poNumber: "PO-78", poDate: "2026-09-01" }, true],
    [{ poNumber: "PO-77", poDate: "2026-09-02" }, true],
  ])("%o -> %s", (next, changed) => {
    expect(detailsChanged(row, next)).toBe(changed)
  })
})

describe("edit wizard round trip", () => {
  const stored = line({
    id: 7,
    quotationItemId: 70,
    offeredItemId: 42,
    itemCode: "123456",
    unitId: 2,
    unitCode: "MTR",
    shipDestination: "Gudang B",
    isAvailable: false,
    // costPrice absent: unknown cost
  })
  const unitCode = () => ""
  const [hydrated] = poLinesToEdit([stored, line({ id: 8, itemType: "shipping" })], unitCode)

  it("hydrates one wizard row per product line", () => {
    expect(poLinesToEdit([stored, line({ id: 8, itemType: "shipping" })], unitCode)).toHaveLength(1)
    expect(hydrated).toMatchObject({
      id: 7,
      satuan: "MTR",
      jumlah: 2,
      hargaBeli: 0,
      hargaJual: 100,
    })
  })

  it("sends an untouched line back exactly as stored", () => {
    expect(lineToInput(hydrated, units)).toEqual({
      quotationItemId: 70,
      offeredItemId: 42,
      itemName: "Rope",
      itemCode: "123456",
      qty: "2.00",
      unitId: 2,
      sellingPrice: "100.00",
      costPrice: undefined,
      isAvailable: false,
      shipDestination: "Gudang B",
    })
  })

  it("keeps stored flags and unknown cost on an edited quantity", () => {
    const edited: PoEditLine = { ...hydrated, jumlah: 5, touched: true }
    expect(lineToInput(edited, units)).toEqual({
      quotationItemId: 70,
      offeredItemId: 42,
      itemName: "Rope",
      itemCode: "123456",
      qty: "5",
      unitId: 2,
      sellingPrice: "100",
      costPrice: undefined,
      isAvailable: false,
      shipDestination: "Gudang B",
    })
  })

  it("sends a cost the user entered", () => {
    const edited: PoEditLine = { ...hydrated, hargaBeli: 80, touched: true }
    expect(lineToInput(edited, units).costPrice).toBe("80")
  })

  it("keeps a known cost on edit", () => {
    const [known] = poLinesToEdit([line({ costPrice: "60.00", unitCode: "PCS" })], unitCode)
    expect(lineToInput({ ...known, jumlah: 3, touched: true }, units).costPrice).toBe("60")
  })

  it("builds a new line from the form", () => {
    const fresh: PoEditLine = {
      id: 99,
      itemId: 5,
      nama: "Shackle",
      kodeImpa: "",
      requestedNama: "Shackle",
      requestedKodeImpa: "",
      vendor: "PT Laut",
      jumlah: 1,
      satuan: "pcs",
      hargaBeli: 0,
      hargaJual: 50,
    }
    expect(lineToInput(fresh, units)).toEqual({
      quotationItemId: undefined,
      offeredItemId: 5,
      itemName: "Shackle",
      itemCode: undefined,
      qty: "1",
      unitId: 1,
      sellingPrice: "50",
      costPrice: "0",
      isAvailable: undefined,
      shipDestination: undefined,
    })
  })
})

describe("linesMissingUnit", () => {
  const [legacy] = poLinesToEdit([line({ id: 1, itemName: "Legacy" })], () => "")
  const [known] = poLinesToEdit(
    [line({ id: 2, itemName: "Known", unitCode: "PCS", unitId: 1 })],
    () => "",
  )

  it("lets an untouched or unit-less stored line pass", () => {
    expect(linesMissingUnit([legacy, { ...legacy, touched: true }, known], units)).toEqual([])
  })

  it("flags an edited line with an unknown unit", () => {
    expect(linesMissingUnit([{ ...known, satuan: "BOX", touched: true }], units)).toEqual(["Known"])
  })

  it("flags a new line with no unit", () => {
    const fresh = { ...known, source: undefined, satuan: "" }
    expect(linesMissingUnit([fresh], units)).toEqual(["Known"])
  })
})

describe("poHistoryEntry", () => {
  const ev = {
    id: 1,
    toStatus: "PENDING",
    changedBy: 3,
    changedAt: "2026-09-01T03:00:00Z",
  } as const

  it("names the creation row without its fixed note", () => {
    expect(poHistoryEntry({ ...ev, note: "PO dibuat" }, "Admin").action).toBe(
      "Dibuat sebagai Pending",
    )
  })

  it("keeps a backfill note", () => {
    expect(poHistoryEntry({ ...ev, note: "Status saat riwayat mulai dicatat" }).action).toBe(
      "Pending: Status saat riwayat mulai dicatat",
    )
  })

  it("shows the move and its reason", () => {
    const cancel = {
      ...ev,
      fromStatus: "UPLOADED",
      toStatus: "CANCELLED",
      note: "Klien batal",
    } as const
    expect(poHistoryEntry(cancel).action).toBe("PO Diunggah → Dibatalkan: Klien batal")
  })

  it("falls back to the user id", () => {
    expect(poHistoryEntry(ev).date).toMatch(/· Pengguna #3$/)
    expect(poHistoryEntry(ev, "Admin").date).toMatch(/· Admin$/)
  })
})
