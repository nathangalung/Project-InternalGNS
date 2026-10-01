import { describe, expect, it } from "vitest"
import type { LineRecommendation, MatchRowResult } from "@/types/api"
import { importedLines, importSummary } from "./import"
import type { ProductItem } from "./wizard"

function row(i: number, over: Partial<MatchRowResult> = {}): MatchRowResult {
  return {
    index: i,
    requested: { name: `Permintaan ${i}`, impaCode: "", qty: 2, unit: "pcs" },
    confidence: 0,
    source: "NONE",
    ...over,
  }
}

const matched = (i: number, itemId: number): MatchRowResult =>
  row(i, {
    matched: {
      itemId,
      itemName: `Katalog ${itemId}`,
      impaCode: `IM${itemId}`,
      defaultUnitCode: "SET",
      vendorProductId: 900,
      vendorId: 90,
      vendorName: "Vendor Termurah",
      costPrice: "1000",
    },
    confidence: 0.9,
    source: "CATALOG_MATCH",
  })

describe("importedLines", () => {
  const recs: LineRecommendation[] = [
    {
      itemId: 11,
      vendorProductId: 501,
      vendorId: 51,
      vendorName: "Vendor Langganan",
      costPrice: "120000.00",
      sellingPrice: "150000.00",
    },
    {
      itemId: 12,
      vendorProductId: 502,
      vendorId: 52,
      vendorName: "Vendor B",
      costPrice: "50000.00",
    },
  ]

  it("fills each matched line from its recommendation", () => {
    const [line] = importedLines([matched(0, 11)], recs, 3)
    expect(line).toEqual({
      id: 4,
      itemId: 11,
      vendorId: 51,
      vendorProductId: 501,
      nama: "Katalog 11",
      kodeImpa: "IM11",
      requestedNama: "Permintaan 0",
      requestedKodeImpa: "",
      vendor: "Vendor Langganan",
      jumlah: 2,
      satuan: "SET",
      hargaBeli: 120000,
      hargaJual: 150000,
    } satisfies ProductItem)
  })

  it("keeps harga jual at 0 for an item never sold", () => {
    const [line] = importedLines([matched(0, 12)], recs, 0)
    expect([line.vendor, line.hargaBeli, line.hargaJual]).toEqual(["Vendor B", 50000, 0])
  })

  it("leaves a matched item with no recommendation unpriced and vendorless", () => {
    const [line] = importedLines([matched(0, 13)], recs, 0)
    expect(line.itemId).toBe(13)
    expect([line.vendor, line.vendorId, line.vendorProductId]).toEqual(["", undefined, undefined])
    expect([line.hargaBeli, line.hargaJual]).toEqual([0, 0])
  })

  it("keeps an unmatched request as asked, upper-casing its codes", () => {
    const [line] = importedLines(
      [row(0, { requested: { name: "Tali", impaCode: "ab12", qty: 0, unit: "roll" } })],
      recs,
      0,
    )
    expect(line).toMatchObject({
      itemId: undefined,
      nama: "Tali",
      kodeImpa: "AB12",
      requestedKodeImpa: "AB12",
      satuan: "ROLL",
      jumlah: 0,
      vendor: "",
      hargaBeli: 0,
      hargaJual: 0,
    })
  })
})

describe("importSummary", () => {
  const created = (i: number, itemId: number): MatchRowResult => ({
    ...matched(i, itemId),
    source: "CREATED",
  })
  const filled: LineRecommendation = {
    itemId: 11,
    vendorProductId: 1,
    vendorId: 1,
    vendorName: "V",
    costPrice: "1",
    sellingPrice: "2",
  }

  it("counts matches, new products, and what still needs work", () => {
    const rows = [matched(0, 11), matched(1, 12), created(2, 13)]
    expect(importSummary(importedLines(rows, [filled], 0), rows, 0)).toBe(
      "3 produk diimport (2 cocok katalog, 1 produk baru). 1 terisi otomatis; 2 perlu vendor dan harga sebelum dikirim.",
    )
  })

  it("says when every line is filled", () => {
    const rows = [matched(0, 11)]
    expect(importSummary(importedLines(rows, [filled], 0), rows, 0)).toBe(
      "1 produk diimport (1 cocok katalog, 0 produk baru). Semua terisi otomatis.",
    )
  })

  it("adds the lines whose unit is unknown", () => {
    const rows = [matched(0, 11)]
    expect(importSummary(importedLines(rows, [filled], 0), rows, 1)).toBe(
      "1 produk diimport (1 cocok katalog, 0 produk baru). Semua terisi otomatis. 1 produk perlu satuan yang dikenal; pilih lewat tombol edit.",
    )
  })
})
