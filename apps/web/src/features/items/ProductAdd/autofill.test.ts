import { describe, expect, it } from "vitest"
import {
  applyUntouched,
  mergeVendorOptions,
  recommendationFields,
  withSavedVendors,
} from "./autofill"
import type { VendorOption } from "./helpers"

describe("mergeVendorOptions", () => {
  const linked: VendorOption[] = [
    { nama: "Vendor Mahal", harga: 120, vendorId: 2, vendorProductId: 20 },
    { nama: "Vendor Murah", harga: 100, vendorId: 1, vendorProductId: 10 },
  ]

  it("lists linked vendors cheapest first, then other vendors from the search", () => {
    const out = mergeVendorOptions(linked, [
      { id: 1, name: "Vendor Murah" },
      { id: 3, name: "Vendor Baru" },
    ])
    expect(out).toEqual([
      { nama: "Vendor Murah", harga: 100, vendorId: 1, vendorProductId: 10 },
      { nama: "Vendor Mahal", harga: 120, vendorId: 2, vendorProductId: 20 },
      { nama: "Vendor Baru", harga: 0, vendorId: 3 },
    ])
  })

  it("puts an unpriced link after the priced ones", () => {
    const out = mergeVendorOptions([{ nama: "Tanpa Harga", harga: 0, vendorId: 5 }, ...linked], [])
    expect(out.map((v) => v.nama)).toEqual(["Vendor Murah", "Vendor Mahal", "Tanpa Harga"])
  })
})

describe("withSavedVendors", () => {
  const linked: VendorOption[] = [
    { nama: "Vendor Tertaut", harga: 90, vendorId: 1, vendorProductId: 10 },
  ]
  const saved: VendorOption = {
    nama: "Vendor Tersimpan",
    harga: 80,
    vendorId: 2,
    vendorProductId: 20,
  }

  it("keeps the saved link while the product is the saved one", () => {
    expect(withSavedVendors(linked, [saved], true)).toEqual([...linked, saved])
  })

  it("drops the saved link once the product changes, keeping the vendor", () => {
    const out = withSavedVendors(linked, [saved], false)
    expect(out).toEqual([...linked, { nama: "Vendor Tersimpan", harga: 80, vendorId: 2 }])
    expect(out[1]?.vendorProductId).toBeUndefined()
  })

  it("lets a linked vendor win over the saved copy", () => {
    const stale: VendorOption = {
      nama: "Vendor Tertaut",
      harga: 70,
      vendorId: 1,
      vendorProductId: 99,
    }
    expect(withSavedVendors(linked, [stale], false)).toEqual(linked)
  })
})

describe("recommendationFields", () => {
  it("fills vendor and both prices from a full recommendation", () => {
    expect(
      recommendationFields({
        itemId: 7,
        vendorProductId: 70,
        vendorId: 4,
        vendorName: "Vendor Langganan",
        costPrice: "120000.00",
        sellingPrice: "150000.00",
      }),
    ).toEqual({
      namaVendor: "Vendor Langganan",
      vendorId: 4,
      vendorProductId: 70,
      hargaBeli: "120000",
      hargaJual: "150000",
    })
  })

  it("leaves harga jual alone for an item never sold", () => {
    expect(
      recommendationFields({
        itemId: 7,
        vendorProductId: 70,
        vendorId: 4,
        vendorName: "V",
        costPrice: "50000.00",
      }),
    ).toEqual({ namaVendor: "V", vendorId: 4, vendorProductId: 70, hargaBeli: "50000" })
  })

  it("fills nothing without a vendor or a price", () => {
    expect(recommendationFields({ itemId: 7 })).toEqual({})
  })
})

describe("recommendationFields with unreadable prices", () => {
  it("leaves a price blank rather than writing NaN", () => {
    expect(recommendationFields({ itemId: 7, costPrice: "x", sellingPrice: "y" })).toEqual({
      hargaBeli: "",
      hargaJual: "",
    })
  })
})

describe("applyUntouched", () => {
  const base = { namaVendor: "", hargaBeli: "", hargaJual: "" }
  const form = {
    requestedKodeImpaNama: "A",
    kodeImpaNama: "A",
    jumlahProduk: "1",
    satuan: "PCS",
    namaVendor: "",
    hargaBeli: "",
    hargaJual: "",
  }
  const fields = {
    namaVendor: "Vendor Rekomendasi",
    vendorId: 4,
    vendorProductId: 40,
    hargaBeli: "100",
    hargaJual: "150",
  }

  it("fills every field the user has not touched since the pick", () => {
    const out = applyUntouched(form, base, fields)
    expect(out.form).toMatchObject(fields)
    expect(out.applied).toEqual({ beli: true, jual: true })
  })

  it("keeps a vendor and prices the user set before the recommendation arrived", () => {
    const typed = {
      ...form,
      namaVendor: "Vendor Pilihan",
      vendorId: 9,
      hargaBeli: "90",
      hargaJual: "140",
    }
    const out = applyUntouched(typed, base, fields)
    expect(out.form).toEqual(typed)
    expect(out.applied).toEqual({ beli: false, jual: false })
  })

  it("fills only what the recommendation knows", () => {
    const out = applyUntouched(form, base, { hargaBeli: "100" })
    expect([out.form.namaVendor, out.form.hargaBeli, out.form.hargaJual]).toEqual(["", "100", ""])
    expect(out.applied).toEqual({ beli: true, jual: false })
  })
})
