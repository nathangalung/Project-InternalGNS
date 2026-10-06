import { describe, expect, it } from "vitest"
import type { ProductRow } from "@/features/quotations/types"
import { offerDiffers, profitAfterDiscount } from "./helpers"

function row(qty: number, sell: number, cost: number): ProductRow {
  return { kode: "", nama: "x", qty, satuan: "PCS", hargaSatuan: sell, profitSatuan: sell - cost }
}

describe("profitAfterDiscount total", () => {
  it("takes the discount off the gross profit", () => {
    // gross 2*(100-60) + 1*(50-30) = 100, discount 15
    expect(profitAfterDiscount([row(2, 100, 60), row(1, 50, 30)], 15)).toBe(85)
  })

  it("equals gross profit with no discount", () => {
    expect(profitAfterDiscount([row(3, 10, 4)], 0)).toBe(18)
  })
})

describe("offerDiffers", () => {
  const base: ProductRow = {
    kode: "790268",
    nama: "LAMPU LED",
    qty: 1,
    satuan: "PCS",
    hargaSatuan: 1,
    profitSatuan: 0,
  }
  it.each([
    {
      name: "same code and name",
      over: { requestedKode: "790268", requestedNama: "LAMPU LED" },
      want: false,
    },
    { name: "no request stored", over: {}, want: false },
    { name: "another name", over: { requestedNama: "LAMPU TL" }, want: true },
    { name: "another code", over: { requestedKode: "790269" }, want: true },
    {
      name: "a request without a code differs on name only",
      over: { requestedNama: "LAMPU LED" },
      want: false,
    },
  ])("$name", ({ over, want }) => {
    expect(offerDiffers({ ...base, ...over })).toBe(want)
  })
})
