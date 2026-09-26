import { describe, expect, it } from "vitest"
import type { InvoiceItemRow } from "@/types/api"
import { invoiceItemsToProducts, invoiceItemsToShipping } from "./adapters"

function line(over: Partial<InvoiceItemRow>): InvoiceItemRow {
  return {
    id: 1,
    invoiceId: 9,
    lineType: "product",
    itemName: "Rope",
    qty: "2",
    unitPrice: "900",
    ...over,
  }
}

describe("invoiceItemsToProducts", () => {
  it("shows the gross price and nets profit on the billed price", () => {
    const [p] = invoiceItemsToProducts([
      line({ id: 7, offeredItemId: 42, grossUnitPrice: "1000", costPrice: "600", itemCode: "A1" }),
    ])
    expect(p).toMatchObject({
      itemId: 42,
      lineId: 7,
      kode: "A1",
      nama: "Rope",
      qty: 2,
      hargaSatuan: 1000,
      profitSatuan: 300,
    })
  })

  it("keeps free-text lines unlinked", () => {
    const [p] = invoiceItemsToProducts([line({})])
    expect(p).toMatchObject({ itemId: undefined, hargaSatuan: 900 })
  })

  it("skips shipping lines", () => {
    expect(invoiceItemsToProducts([line({ lineType: "shipping" })])).toEqual([])
  })

  it("handles no items", () => {
    expect(invoiceItemsToProducts(undefined)).toEqual([])
  })
})

describe("invoiceItemsToShipping", () => {
  it("totals the first shipping line", () => {
    const ship = invoiceItemsToShipping([
      line({
        lineType: "shipping",
        itemName: "Kirim",
        qty: "1",
        unitPrice: "50000",
        shipDestination: "Batam",
      }),
    ])
    expect(ship).toEqual({ nama: "Kirim", deadline: "", hargaSatuan: 50000, alamat: "Batam" })
  })

  it("is empty without shipping", () => {
    expect(invoiceItemsToShipping([line({})])).toEqual({ nama: "", deadline: "", hargaSatuan: 0 })
  })
})

describe("invoiceItemsToShipping destination", () => {
  it("leaves the destination unset when the snapshot has none", () => {
    const ship = invoiceItemsToShipping([
      line({ lineType: "shipping", itemName: "Kirim", qty: "2", unitPrice: "100" }),
    ])
    expect(ship).toEqual({ nama: "Kirim", deadline: "", hargaSatuan: 200, alamat: undefined })
  })
})
