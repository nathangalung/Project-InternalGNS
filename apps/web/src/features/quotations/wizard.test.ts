import { describe, expect, it } from "vitest"
import type { ProductAddFormData } from "@/features/items/ProductAdd/helpers"
import type { QuotationDetail } from "@/types/api"
import {
  countUnknownUnits,
  type ProductItem,
  seedFromDetail,
  splitOffer,
  unitIdIndex,
  unitIssue,
  upsertProduct,
  validityInput,
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

  it("refuses a blank address the caller requires", () => {
    const g = wizardGates({ ...base, shippingTime: "3", addressRequired: true })
    expect(g.isAlamatOk).toBe(false)
    expect(g.isWaktuFilled).toBe(false)
    expect(
      wizardGates({ ...base, shippingAddress: ADDRESS, addressRequired: true }).isAlamatOk,
    ).toBe(true)
  })
})

describe("wizardSummary", () => {
  it("leaves no-offer lines out of every total", () => {
    const offeredOnly = wizardSummary([product(1)], 10, "")
    const withNoOffer = wizardSummary(
      [product(1), product(2, { noOffer: true, hargaBeli: 30, hargaJual: 50 })],
      10,
      "",
    )
    expect(withNoOffer).toEqual(offeredOnly)
  })

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
      dpp: 11206.25,
      ppn: 1344.75,
      grandTotal: 13569.75,
      profit: 75,
    })
  })

  it("discounts and taxes per line, as the server stores it", () => {
    const s = wizardSummary(
      [
        product(1, { jumlah: 1, hargaJual: 333.33 }),
        product(2, { jumlah: 3, hargaJual: 0.97 }),
        product(3, { jumlah: 7, hargaJual: 1234.57 }),
      ],
      2.5,
      "100.01",
    )
    expect(s).toMatchObject({
      nominalDiskon: 224.45,
      subTotal: 8753.78,
      dpp: 8115.98,
      ppn: 973.91,
      grandTotal: 9827.7,
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

  it("counts lines whose unit is not a known code, whatever its case", () => {
    const lines = [
      product(1, { satuan: "pcs" }),
      product(2, { satuan: "BOX" }),
      product(3, { satuan: "" }),
      product(4, { satuan: "set" }),
    ]
    expect(countUnknownUnits(lines, index)).toBe(2)
    expect(countUnknownUnits([product(1, { satuan: "PCS" })], index)).toBe(0)
  })

  it.each([
    ["a known code", "Pcs", null],
    ["an unknown code", "pc", 'Satuan "pc" tidak dikenal.'],
    ["a blank unit", "  ", "Satuan belum diisi."],
    ["a padded known code", " PCS ", 'Satuan "PCS" tidak dikenal.'],
  ])("explains %s", (_name, satuan, want) => {
    expect(unitIssue(satuan, index)).toBe(want)
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

describe("validityInput", () => {
  // Zero is sent for the server to refuse, never dropped to blank.
  it.each([
    ["", undefined],
    ["  ", undefined],
    [" 14 ", 14],
    ["0", 0],
    ["-2", -2],
  ])("%j is %s", (typed, want) => {
    expect(validityInput(typed)).toBe(want)
  })
})
