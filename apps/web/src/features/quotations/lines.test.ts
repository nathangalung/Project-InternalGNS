import { describe, expect, it } from "vitest"
import { ApiError } from "@/lib/api-client"
import { problem } from "@/test/problem"
import type { ProblemDetail } from "@/types/api"
import {
  countInvalidQty,
  incompleteLines,
  isLineComplete,
  isValidQty,
  lineGaps,
  PO_QTY_ERROR,
  parseQty,
  QTY_ERROR,
  qtyErrorIndexes,
  qtyErrorsById,
  qtyIssue,
  requestDiffers,
  requestedCode,
  type StoredLine,
} from "./lines"
import type { ProductItem } from "./wizard"

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

  it("counts only negatives on a PO", () => {
    expect(countInvalidQty([{ jumlah: 1 }, { jumlah: 0 }, { jumlah: -3 }], true)).toBe(1)
  })
})

describe("qtyIssue rule", () => {
  // A PO line may stay at qty 0; a quotation line may not.
  it.each<[number, boolean, string | undefined]>([
    [3, false, undefined],
    [0, false, QTY_ERROR],
    [-1, false, QTY_ERROR],
    [3, true, undefined],
    [0, true, undefined],
    [-1, true, PO_QTY_ERROR],
    [Number.NaN, true, PO_QTY_ERROR],
  ])("qty %d, zero allowed %s", (qty, allowZero, want) => {
    expect(qtyIssue(qty, allowZero)).toBe(want)
  })
})

describe("qtyErrorIndexes mapping", () => {
  const err = new ApiError(
    422,
    problem(422, {
      fields: {
        "items[2].qty": "Jumlah harus berupa angka lebih dari 0.",
        "items[0].sellingPrice": "x",
        status: "y",
      },
    }),
    "x",
  )

  it("reads indexed qty keys only", () => {
    expect([...qtyErrorIndexes(err)]).toEqual([[2, "Jumlah harus berupa angka lebih dari 0."]])
  })

  it("maps indexes to card ids", () => {
    const lines = [{ id: 10 }, { id: 11 }, { id: 12 }]
    expect(qtyErrorsById(lines, qtyErrorIndexes(err))).toEqual({
      12: "Jumlah harus berupa angka lebih dari 0.",
    })
  })

  it("ignores non-422 errors", () => {
    expect(qtyErrorIndexes(new Error("x")).size).toBe(0)
    expect(
      qtyErrorIndexes(new ApiError(409, problem(409, { fields: { "items[0].qty": "x" } }), "x"))
        .size,
    ).toBe(0)
  })
})

describe("request code and difference", () => {
  const base = { nama: "Rope", kodeImpa: "222", requestedNama: "Rope", requestedKodeImpa: "" }
  const cases: {
    name: string
    line: Parameters<typeof requestedCode>[0]
    code: string
    differs: boolean
  }[] = [
    {
      name: "catalog offer, code-less request",
      line: { ...base, itemId: 5 },
      code: "",
      differs: false,
    },
    {
      name: "catalog offer, other request code",
      line: { ...base, itemId: 5, requestedKodeImpa: "111" },
      code: "111",
      differs: true,
    },
    {
      name: "catalog offer, same request code",
      line: { ...base, itemId: 5, requestedKodeImpa: "222" },
      code: "222",
      differs: false,
    },
    { name: "free-text offer rides on the request", line: base, code: "222", differs: false },
    {
      name: "request names another product",
      line: { ...base, itemId: 5, requestedNama: "Tali" },
      code: "",
      differs: true,
    },
    {
      name: "a request without a name reads as the offer",
      line: { ...base, itemId: 5, requestedNama: "" },
      code: "",
      differs: false,
    },
  ]

  for (const c of cases) {
    it(c.name, () => {
      expect(requestedCode(c.line)).toBe(c.code)
      expect(requestDiffers(c.line)).toBe(c.differs)
    })
  }
})

describe("qtyErrorIndexes odd 422 bodies", () => {
  it.each<[string, ProblemDetail | null]>([
    ["no body", null],
    ["no fields", problem(422, { detail: "Validasi gagal." })],
  ])("finds no line for %s", (_name, body) => {
    expect(qtyErrorIndexes(new ApiError(422, body, "x")).size).toBe(0)
  })

  it("drops an index past the last card", () => {
    const byIndex = new Map([[5, "Jumlah harus lebih dari 0."]])
    expect(qtyErrorsById([{ id: 1 }], byIndex)).toEqual({})
  })
})

describe("line completeness", () => {
  const base: ProductItem = {
    id: 1,
    itemId: 3,
    vendorProductId: 7,
    nama: "A",
    kodeImpa: "",
    requestedNama: "A",
    requestedKodeImpa: "",
    vendor: "V",
    jumlah: 1,
    satuan: "PCS",
    hargaBeli: 10,
    hargaJual: 20,
  }

  it.each<[string, Partial<ProductItem>, string[]]>([
    ["a complete line", {}, []],
    ["a vendor picked but not linked yet", { vendorProductId: undefined, vendorId: 4 }, []],
    ["no product", { itemId: undefined }, ["produk"]],
    ["no vendor", { vendorProductId: undefined, vendor: "" }, ["vendor"]],
    ["nothing priced", { hargaBeli: 0, hargaJual: 0 }, ["harga beli", "harga jual"]],
    ["no offer, nothing priced", { noOffer: true, hargaJual: 0, hargaBeli: 0, vendor: "" }, []],
  ])("%s", (_name, over, want) => {
    const line = { ...base, ...over }
    expect(lineGaps(line)).toEqual(want)
    expect(isLineComplete(line)).toBe(want.length === 0)
  })
})

describe("incompleteLines", () => {
  const done: StoredLine = {
    itemType: "product",
    isAvailable: true,
    offeredItemId: 1,
    unitId: 2,
    vendorProductId: 3,
    costPrice: "1000",
    sellingPrice: "1500",
  }
  it.each([
    { name: "a complete line", line: done, want: 0 },
    { name: "no product", line: { ...done, offeredItemId: undefined }, want: 1 },
    { name: "no unit", line: { ...done, unitId: undefined }, want: 1 },
    { name: "no vendor", line: { ...done, vendorProductId: undefined }, want: 1 },
    { name: "no harga beli", line: { ...done, costPrice: "0" }, want: 1 },
    { name: "no harga jual", line: { ...done, sellingPrice: "0" }, want: 1 },
    { name: "Tidak Ditawarkan", line: { ...done, isAvailable: false, sellingPrice: "0" }, want: 0 },
    {
      name: "the shipping line",
      line: { ...done, itemType: "shipping", offeredItemId: undefined },
      want: 0,
    },
  ])("$name", ({ line, want }) => {
    expect(incompleteLines([line])).toBe(want)
  })
})
