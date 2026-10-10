import { describe, expect, it } from "vitest"
import type { ProductAddFormData } from "@/features/items/ProductAdd/helpers"
import { unitIndex } from "@/features/units/match"
import { formatRupiah } from "@/lib/format"
import type { PurchaseOrderItemRow, PurchaseOrderRow } from "@/types/api"
import {
  detailsChanged,
  linesMissingUnit,
  linesNeedAddress,
  lineToInput,
  loadFailureMessage,
  type PoEditLine,
  poHistoryEntry,
  poItemsToProducts,
  poItemsToShipping,
  poLinesToEdit,
  poNeedsAddress,
  poRowFromBackend,
  upsertPoLine,
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

const units = unitIndex([
  { id: 1, code: "PCS", aliases: ["PIECES"] },
  { id: 2, code: "MTR", aliases: ["METER"] },
])

describe("poItemsToProducts", () => {
  it("keeps the offered item and vendor for links", () => {
    const rows = poItemsToProducts([
      line({
        offeredItemId: 42,
        vendorId: 7,
        vendorName: "PT Laut",
        productUrl: "https://toko.example/rope",
      }),
      line({ id: 2 }),
    ])
    expect(rows.map((r) => [r.itemId, r.vendorId, r.vendor, r.storeUrl])).toEqual([
      [42, 7, "PT Laut", "https://toko.example/rope"],
      [undefined, undefined, undefined, undefined],
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
    quotationNo: "Q-00001/GNS/IX/2026",
    poNumber: "PO-77",
    poDate: "2026-09-01T00:00:00+07:00",
    companyClientId: 4,
    companyName: "PT Samudra",
    status: "ON_PROGRESS",
    quotationTotal: "999000.00",
    poGrandTotal: "799200.00",
    rowVersion: 3,
    deliveryNoteNumber: "DN-00001/GNS/IX/2026",
  } as PurchaseOrderRow

  it("shows the PO total, not the quotation total", () => {
    const row = poRowFromBackend(po)
    expect(row.total).toBe(formatRupiah("799200.00"))
    expect(row.poDate).toBe("2026-09-01")
    expect(row.rowVersion).toBe(3)
    expect(row.deliveryNoteNumber).toBe("DN-00001/GNS/IX/2026")
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

  // Numberless PO compares blank.
  it.each([
    [{ poNumber: "  ", poDate: "2026-09-01" }, false],
    [{ poNumber: "PO-1", poDate: "2026-09-01" }, true],
  ])("numberless %o -> %s", (next, changed) => {
    expect(detailsChanged({ poDate: "2026-09-01" }, next)).toBe(changed)
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
    vendorProductId: 700,
    vendorId: 7,
    vendorName: "PT Laut",
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
      vendorId: 7,
      vendorProductId: 700,
      vendor: "PT Laut",
    })
  })

  it("sends an untouched line back exactly as stored", () => {
    expect(lineToInput(hydrated, units)).toEqual({
      id: 7,
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
      vendorProductId: 700,
    })
  })

  it("keeps stored flags, vendor and unknown cost on an edited quantity", () => {
    const edited: PoEditLine = { ...hydrated, jumlah: 5, touched: true }
    expect(lineToInput(edited, units)).toEqual({
      id: 7,
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
      vendorProductId: 700,
      vendorId: undefined,
    })
  })

  it("leaves out a harga jual the role cannot see", () => {
    const [hidden] = poLinesToEdit([{ ...stored, sellingPrice: undefined }], unitCode)
    const edited: PoEditLine = { ...hidden, hargaBeli: 55, touched: true }
    const input = lineToInput(edited, units)
    expect(input).toMatchObject({ id: 7, costPrice: "55" })
    expect(input).not.toHaveProperty("sellingPrice", expect.anything())
  })

  it("sends no id for a line added in the edit", () => {
    const added: PoEditLine = { ...hydrated, id: 99, source: undefined }
    expect(lineToInput(added, units).id).toBeUndefined()
  })

  it("sends the vendor picked in the edit", () => {
    const edited: PoEditLine = { ...hydrated, vendorId: 8, vendorProductId: 800, touched: true }
    expect(lineToInput(edited, units)).toMatchObject({ vendorProductId: 800, vendorId: undefined })
  })

  it("sends a vendor picked without a link by its id", () => {
    const edited: PoEditLine = {
      ...hydrated,
      vendorId: 9,
      vendorProductId: undefined,
      touched: true,
    }
    expect(lineToInput(edited, units)).toMatchObject({ vendorProductId: undefined, vendorId: 9 })
  })

  it("sends no vendor once it is cleared", () => {
    const edited: PoEditLine = {
      ...hydrated,
      vendorId: undefined,
      vendorProductId: undefined,
      touched: true,
    }
    expect(lineToInput(edited, units)).toMatchObject({
      vendorProductId: undefined,
      vendorId: undefined,
    })
  })

  it("drops the quotation line once the product is swapped", () => {
    const edited: PoEditLine = { ...hydrated, itemId: 43, touched: true }
    expect(lineToInput(edited, units)).toMatchObject({
      quotationItemId: undefined,
      offeredItemId: 43,
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
      vendorId: 7,
      vendorProductId: 500,
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
      vendorProductId: 500,
      vendorId: undefined,
    })
  })
})

describe("upsertPoLine", () => {
  const [stored] = poLinesToEdit(
    [line({ id: 7, offeredItemId: 42, unitId: 2, unitCode: "MTR", costPrice: "60.00" })],
    () => "",
  )
  const form: ProductAddFormData = {
    requestedKodeImpaNama: "",
    kodeImpaNama: "123456 - Rope",
    jumlahProduk: "0",
    satuan: "MTR",
    namaVendor: "PT Laut",
    hargaBeli: "60",
    hargaJual: "100",
    itemId: 42,
    vendorId: 7,
    vendorProductId: 700,
  }

  // A PO line may be kept at qty 0.
  it("keeps a qty 0 edit at 0 and sends it so", () => {
    const [edited] = upsertPoLine([stored], stored, form)
    expect(edited).toMatchObject({ id: 7, jumlah: 0, touched: true, source: stored.source })
    expect(lineToInput(edited, units).qty).toBe("0")
  })

  it("keeps a negative qty so the editor can flag it", () => {
    const [edited] = upsertPoLine([stored], stored, { ...form, jumlahProduk: "-1" })
    expect(edited.jumlah).toBe(-1)
  })

  it("leaves the other lines alone", () => {
    const other: PoEditLine = { ...stored, id: 8 }
    const out = upsertPoLine([stored, other], stored, form)
    expect(out[1]).toBe(other)
  })

  it("appends a new line untouched and without a source", () => {
    const out = upsertPoLine([stored], null, { ...form, jumlahProduk: "4" })
    expect(out).toHaveLength(2)
    expect(out[1]).toMatchObject({ id: 8, jumlah: 4, nama: "Rope", kodeImpa: "123456" })
    expect(out[1].source).toBeUndefined()
    expect(out[1].touched).toBeUndefined()
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

  it("takes a unit alias as its unit", () => {
    const edited = { ...known, satuan: "meter.", touched: true }
    expect(linesMissingUnit([edited], units)).toEqual([])
    expect(lineToInput(edited, units).unitId).toBe(2)
  })

  it("flags a new line with no unit", () => {
    const fresh = { ...known, source: undefined, satuan: "" }
    expect(linesMissingUnit([fresh], units)).toEqual(["Known"])
  })
})

describe("linesNeedAddress", () => {
  const [own] = poLinesToEdit([line({ id: 1, shipDestination: "Gudang B" })], () => "")
  const [bare] = poLinesToEdit([line({ id: 2, shipDestination: "  " })], () => "")

  it("lets lines that carry their own destination pass", () => {
    expect(linesNeedAddress([own])).toBe(false)
  })

  it("flags a stored line with a blank destination or a new line", () => {
    expect(linesNeedAddress([own, bare])).toBe(true)
    expect(linesNeedAddress([own, { ...own, source: undefined }])).toBe(true)
  })
})

describe("poNeedsAddress", () => {
  const [own] = poLinesToEdit([line({ id: 1, shipDestination: "Gudang B" })], () => "")
  const [bare] = poLinesToEdit([line({ id: 2 })], () => "")

  it("asks past the gate while a line has no destination", () => {
    expect(poNeedsAddress("ON_PROGRESS", [bare])).toBe(true)
    expect(poNeedsAddress("DELIVERED", [bare])).toBe(true)
    expect(poNeedsAddress("DELIVERED", [own])).toBe(false)
  })

  it("keeps the address optional before the gate", () => {
    expect(poNeedsAddress("PENDING", [bare])).toBe(false)
    expect(poNeedsAddress("UPLOADED", [bare])).toBe(false)
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

describe("loadFailureMessage", () => {
  it.each([
    [true, false, "Daftar satuan gagal dimuat"],
    [false, true, "Item PO gagal dimuat."],
    [true, true, "Item PO dan daftar satuan gagal dimuat."],
  ])("units=%s items=%s", (units, items, start) => {
    const msg = loadFailureMessage(units, items)
    expect(msg.startsWith(start)).toBe(true)
    expect(msg.endsWith("Coba lagi dalam beberapa saat.")).toBe(true)
  })
})

describe("snapshot edges", () => {
  it("has no products and a blank shipping row without items", () => {
    expect(poItemsToProducts(undefined)).toEqual([])
    const blank = { nama: "Pengiriman", deadline: "", hargaSatuan: 0, alamat: "" }
    expect(poItemsToShipping(undefined)).toEqual(blank)
    expect(poItemsToShipping([line({})])).toEqual(blank)
  })

  it("reads the shipping line with its days and destination", () => {
    const ship = line({
      itemType: "shipping",
      itemName: "Kirim Batam",
      sellingPrice: "75000",
      shipDestination: "Batam",
      shippingDays: 3,
    })
    expect(poItemsToShipping([line({}), ship])).toEqual({
      nama: "Kirim Batam",
      deadline: "",
      hargaSatuan: 75000,
      alamat: "Batam",
      hari: 3,
    })
  })

  it("prints a blank destination rather than undefined", () => {
    const ship = line({ itemType: "shipping", itemName: "Kirim", sellingPrice: "1" })
    expect(poItemsToShipping([ship]).alamat).toBe("")
  })
})

describe("wizard lines without an offered name", () => {
  const [base] = poLinesToEdit([line({ id: 3, itemName: "Tali" })], () => "")
  const nameless: PoEditLine = { ...base, nama: "", touched: true, satuan: "BOX" }

  it("saves the requested name", () => {
    expect(lineToInput(nameless, units).itemName).toBe("Tali")
  })

  it("names the line by its request when the unit is missing", () => {
    expect(linesMissingUnit([nameless], units)).toEqual(["Tali"])
  })
})

describe("poHistoryEntry without a reason", () => {
  it("shows the bare move", () => {
    const ev = {
      id: 2,
      fromStatus: "PENDING",
      toStatus: "UPLOADED",
      note: "   ",
      changedBy: 3,
      changedAt: "2026-09-01T03:00:00Z",
    } as const
    expect(poHistoryEntry(ev).action).toBe("Pending → PO Diunggah")
  })
})
