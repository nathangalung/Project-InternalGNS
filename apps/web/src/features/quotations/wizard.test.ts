import { describe, expect, it } from "vitest"
import type { ProductAddFormData } from "@/features/items/ProductAdd/helpers"
import type { QuotationDetail } from "@/types/api"
import {
  type ProductItem,
  seedFromDetail,
  splitOffer,
  unitIdIndex,
  unitsKnown,
  upsertProduct,
  wizardGates,
  wizardSummary,
} from "./wizard"

function product(id: number, over: Partial<ProductItem> = {}): ProductItem {
  return {
    id,
    nama: `Barang ${id}`,
    kodeImpa: "",
    requestedNama: `Barang ${id}`,
    requestedKodeImpa: "",
    vendor: "",
    jumlah: 2,
    satuan: "PCS",
    hargaBeli: 60,
    hargaJual: 100,
    ...over,
  }
}

const ADDRESS = "Jl. Pelabuhan No. 1, Jakarta Utara"

describe("wizardGates", () => {
  const base = {
    shippingAddress: "",
    shippingTime: "",
    jatuhTempo: "",
    berlakuSampai: "",
    productCount: 0,
  }

  it("leaves an empty wizard without content", () => {
    expect(wizardGates(base)).toEqual({
      isAlamatOk: true,
      isWaktuFilled: false,
      isTenggatWaktuFilled: false,
      hasContent: false,
    })
  })

  it("takes a product or a full address as content", () => {
    expect(wizardGates({ ...base, productCount: 1 }).hasContent).toBe(true)
    expect(wizardGates({ ...base, shippingAddress: ADDRESS }).hasContent).toBe(true)
  })

  it("refuses a short address and the days that ride on it", () => {
    const g = wizardGates({ ...base, shippingAddress: "Jl. A", shippingTime: "3" })
    expect(g.isAlamatOk).toBe(false)
    expect(g.isWaktuFilled).toBe(false)
    expect(g.hasContent).toBe(false)
  })

  it("needs both deadline fields", () => {
    expect(wizardGates({ ...base, jatuhTempo: "30" }).isTenggatWaktuFilled).toBe(false)
    expect(
      wizardGates({ ...base, jatuhTempo: "30", berlakuSampai: " 14 " }).isTenggatWaktuFilled,
    ).toBe(true)
  })

  it("fills the days once the address is fine", () => {
    expect(wizardGates({ ...base, shippingTime: "3" }).isWaktuFilled).toBe(true)
    expect(wizardGates({ ...base, shippingTime: "  " }).isWaktuFilled).toBe(false)
  })
})

describe("wizardSummary", () => {
  it("adds up products, discount, shipping and tax", () => {
    const s = wizardSummary(
      [product(1), product(2, { jumlah: 1, hargaBeli: 30, hargaJual: 50 })],
      10,
      "12000",
    )
    expect(s).toEqual({
      totalProdukQty: 3,
      totalHargaBeli: 150,
      totalHargaJual: 250,
      nominalDiskon: 25,
      subTotal: 225,
      shippingCost: 12000,
      dpp: 11206,
      ppn: 1345,
      grandTotal: 13570,
      profit: 75,
    })
  })

  it("has no profit without products and reads a blank cost as 0", () => {
    const s = wizardSummary([], 0, "")
    expect(s.profit).toBe(0)
    expect(s.shippingCost).toBe(0)
    expect(s.grandTotal).toBe(0)
  })
})

describe("splitOffer", () => {
  it.each<[string, { kode: string; nama: string }]>([
    ["", { kode: "", nama: "" }],
    ["   ", { kode: "", nama: "" }],
    ["232001 - LAMP LED - 12W", { kode: "232001", nama: "LAMP LED - 12W" }],
    ["LAMP - LED", { kode: "", nama: "LAMP - LED" }],
    ["  Tali Tambat ", { kode: "", nama: "Tali Tambat" }],
  ])("%j", (input, want) => {
    expect(splitOffer(input)).toEqual(want)
  })
})

describe("upsertProduct", () => {
  const form: ProductAddFormData = {
    requestedKodeImpaNama: "",
    kodeImpaNama: "232001 - LAMP LED",
    jumlahProduk: "3",
    satuan: "PCS",
    namaVendor: "CV Laut",
    hargaBeli: "70",
    hargaJual: "120",
    itemId: 9,
    vendorId: 4,
    vendorProductId: 5,
  }

  it("appends a new line after the highest id", () => {
    const out = upsertProduct([product(1), product(4)], null, form)
    expect(out).toHaveLength(3)
    expect(out[2]).toEqual({
      id: 5,
      itemId: 9,
      requestedItemId: undefined,
      vendorId: 4,
      vendorProductId: 5,
      nama: "LAMP LED",
      kodeImpa: "232001",
      requestedNama: "LAMP LED",
      requestedKodeImpa: "",
      vendor: "CV Laut",
      jumlah: 3,
      satuan: "PCS",
      hargaBeli: 70,
      hargaJual: 120,
    })
  })

  it("starts at 1 and reads bad prices as 0", () => {
    const out = upsertProduct([], null, { ...form, hargaBeli: "x", hargaJual: "" })
    expect(out[0]).toMatchObject({ id: 1, hargaBeli: 0, hargaJual: 0 })
  })

  it("keeps the requested name when one was given", () => {
    const out = upsertProduct([], null, { ...form, requestedKodeImpaNama: "111 - BOLT" })
    expect(out[0]).toMatchObject({ requestedNama: "BOLT", requestedKodeImpa: "111" })
  })

  it("replaces the edited line in place", () => {
    const lines = [product(1), product(2)]
    const out = upsertProduct(lines, lines[0], form)
    expect(out.map((p) => p.id)).toEqual([1, 2])
    expect(out[0]).toMatchObject({ id: 1, nama: "LAMP LED", jumlah: 3 })
    expect(out[1]).toBe(lines[1])
  })
})

describe("units", () => {
  const index = unitIdIndex([
    { id: 1, code: "pcs" },
    { id: 2, code: "SET" },
  ])

  it("indexes unit ids by upper-case code", () => {
    expect([...index.entries()]).toEqual([
      ["PCS", 1],
      ["SET", 2],
    ])
    expect(unitIdIndex(undefined).size).toBe(0)
  })

  it("knows every line's unit, whatever its case", () => {
    expect(unitsKnown([product(1, { satuan: "pcs" })], index)).toBe(true)
    expect(unitsKnown([product(1, { satuan: "BOX" })], index)).toBe(false)
  })
})

describe("seedFromDetail", () => {
  const detail = {
    companyClientId: 3,
    contactId: 8,
    discountPct: "12.50",
    validityDays: 14,
    paymentTerms: "30 days",
    items: [
      {
        id: 11,
        itemType: "product",
        requestedName: "Tali",
        qty: "2",
        unitId: 1,
        sellingPrice: "100",
      },
      { id: 12, itemType: "product", requestedName: "Baut", qty: "1", sellingPrice: "50" },
      {
        id: 13,
        itemType: "shipping",
        requestedName: "SHIPPING",
        qty: "1",
        sellingPrice: "75000",
        shipDestination: "Dermaga 3",
        shippingDays: 5,
      },
    ],
  } as unknown as QuotationDetail

  it("seeds every step from the stored quotation", () => {
    const s = seedFromDetail(detail, new Map([[1, "PCS"]]))
    expect(s).toMatchObject({
      selectedClient: "3",
      selectedContactId: 8,
      discountPct: 12.5,
      shippingAddress: "Dermaga 3",
      shippingTime: "5",
      shippingCost: "75000",
      berlakuSampai: "14",
      jatuhTempo: "30",
    })
    expect(s.products.map((p) => [p.id, p.satuan])).toEqual([
      [11, "PCS"],
      [12, ""],
    ])
  })

  it("leaves blanks for a quotation without shipping or terms", () => {
    const bare = {
      ...detail,
      contactId: 0,
      discountPct: "x",
      validityDays: undefined,
      paymentTerms: "segera",
      items: [],
    } as unknown as QuotationDetail
    expect(seedFromDetail(bare, new Map())).toEqual({
      selectedClient: "3",
      selectedContactId: undefined,
      discountPct: 0,
      products: [],
      shippingAddress: "",
      shippingTime: "",
      shippingCost: "",
      berlakuSampai: "",
      jatuhTempo: "",
    })
  })
})
