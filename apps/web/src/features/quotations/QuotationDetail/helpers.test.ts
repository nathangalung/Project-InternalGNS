import { describe, expect, it } from "vitest"
import type { ProductRow } from "@/features/quotations/types"
import { profitAfterDiscount } from "./helpers"

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
