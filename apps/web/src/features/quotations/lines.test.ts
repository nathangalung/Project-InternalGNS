import { describe, expect, it } from "vitest"
import { ApiError } from "@/lib/api-client"
import { countInvalidQty, isValidQty, parseQty, qtyErrorIndexes, qtyErrorsById } from "./lines"

describe("parseQty value", () => {
  it("keeps zero and negatives so they can be flagged", () => {
    expect(parseQty("0")).toBe(0)
    expect(parseQty("-2")).toBe(-2)
    expect(parseQty("2.5")).toBe(2.5)
  })

  it("turns junk into zero", () => {
    expect(parseQty("abc")).toBe(0)
    expect(parseQty(undefined)).toBe(0)
  })
})

describe("isValidQty rule", () => {
  it("accepts only above zero", () => {
    expect([0, -1, 0.5, 3].map(isValidQty)).toEqual([false, false, true, true])
  })

  it("counts the bad lines", () => {
    expect(countInvalidQty([{ jumlah: 1 }, { jumlah: 0 }, { jumlah: -3 }])).toBe(2)
  })
})

describe("qtyErrorIndexes mapping", () => {
  const err = new ApiError(
    422,
    {
      fields: {
        "items[2].qty": "jumlah harus lebih besar dari 0",
        "items[0].sellingPrice": "x",
        status: "y",
      },
    },
    "x",
  )

  it("reads indexed qty keys only", () => {
    expect([...qtyErrorIndexes(err)]).toEqual([[2, "jumlah harus lebih besar dari 0"]])
  })

  it("maps indexes to card ids", () => {
    const lines = [{ id: 10 }, { id: 11 }, { id: 12 }]
    expect(qtyErrorsById(lines, qtyErrorIndexes(err))).toEqual({
      12: "jumlah harus lebih besar dari 0",
    })
  })

  it("ignores non-422 errors", () => {
    expect(qtyErrorIndexes(new Error("x")).size).toBe(0)
    expect(qtyErrorIndexes(new ApiError(409, { fields: { "items[0].qty": "x" } }, "x")).size).toBe(
      0,
    )
  })
})
