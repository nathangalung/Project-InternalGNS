import { describe, expect, it } from "vitest"
import type { MatchRowInput } from "@/types/api"
import { parseCsv, parseProductFile, parseQty, rowsFromAOA } from "./uploadParser"

describe("parseQty id-ID number format", () => {
  it("passes native numbers through", () => {
    expect(parseQty(5)).toBe(5)
    expect(parseQty("10")).toBe(10)
  })
  it("reads a dot as the thousands separator", () => {
    expect(parseQty("1.000")).toBe(1000)
    expect(parseQty("1.234.567")).toBe(1234567)
  })
  it("reads a comma as the decimal separator", () => {
    expect(parseQty("1,5")).toBe(1.5)
    expect(parseQty("1.234.567,89")).toBe(1234567.89)
  })
  it("falls back to zero for empty or junk", () => {
    expect(parseQty("")).toBe(0)
    expect(parseQty("abc")).toBe(0)
    expect(parseQty(null)).toBe(0)
  })
})

const HEADER = ["No", "Kode IMPA", "Nama Produk", "Jumlah", "Satuan"]

describe("rowsFromAOA header detection", () => {
  it("parses a header-first sheet", () => {
    const rows = rowsFromAOA([HEADER, [1, "370115", "Marine Radio", "2", "PCS"]])
    expect(rows).toEqual([{ impaCode: "370115", name: "Marine Radio", qty: 2, unit: "PCS" }])
  })

  it("skips a title banner above the header row", () => {
    const rows = rowsFromAOA([
      ["DAFTAR PRODUK PT GLOBAL", "", "", "", ""],
      ["", "", "", "", ""],
      HEADER,
      [1, "370115", "Marine Radio", "1.000", "PCS"],
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ name: "Marine Radio", qty: 1000 })
  })

  it("returns nothing without a name column", () => {
    expect(
      rowsFromAOA([
        ["Foo", "Bar"],
        ["a", "b"],
      ]),
    ).toEqual([])
  })

  it("does not treat a Barcode column as the IMPA code", () => {
    const rows = rowsFromAOA([
      ["Barcode", "Nama", "Jumlah"],
      ["999", "Bolt", "3"],
    ])
    expect(rows[0].impaCode).toBe("")
    expect(rows[0]).toMatchObject({ name: "Bolt", qty: 3 })
  })
})

describe("parseCsv", () => {
  it("handles quotes, escaped quotes, and CRLF", () => {
    const rows = parseCsv('a,"b,c","d""e"\r\n1,2,3\n')
    expect(rows).toEqual([
      ["a", "b,c", 'd"e'],
      ["1", "2", "3"],
    ])
  })
  it("strips a leading BOM", () => {
    const rows = parseCsv("﻿Nama,Jumlah\nBolt,2")
    expect(rows[0][0]).toBe("Nama")
  })
})

describe("rowsFromAOA rows", () => {
  it("skips blank rows and rows without a name", () => {
    const rows = rowsFromAOA([
      HEADER,
      [],
      [null, "", "", "", ""],
      [2, "370116", "   ", "3", "PCS"],
      [3, null, "Baut", "4", null],
    ])
    expect(rows).toEqual([{ impaCode: "", name: "Baut", qty: 4, unit: "" }])
  })

  it("reads zero quantity and blank unit when those columns are missing", () => {
    expect(rowsFromAOA([["Nama"], ["Tali"]])).toEqual([
      { impaCode: "", name: "Tali", qty: 0, unit: "" },
    ])
  })

  it("picks the richest header row when several could match", () => {
    const rows = rowsFromAOA([
      ["Nama Kapal", "", ""],
      ["Nama", "Qty", "Unit"],
      ["Mur", "5", "PCS"],
    ])
    expect(rows).toEqual([{ impaCode: "", name: "Mur", qty: 5, unit: "PCS" }])
  })

  it("keeps the header when a later row only looks like one", () => {
    const rows = rowsFromAOA([
      ["Nama", "Jumlah"],
      ["Nama Baut", "2"],
    ])
    expect(rows).toEqual([{ impaCode: "", name: "Nama Baut", qty: 2, unit: "" }])
  })

  it("skips a row whose name cell is empty", () => {
    expect(rowsFromAOA([HEADER, [1, "370115", null, "2", "PCS"]])).toEqual([])
  })

  it("tolerates holes and nulls in the header scan", () => {
    const aoa: unknown[][] = []
    aoa[2] = [null, "Nama", "Jumlah"]
    aoa[3] = [null, "Kabel", "7"]
    expect(rowsFromAOA(aoa)).toEqual([{ impaCode: "", name: "Kabel", qty: 7, unit: "" }])
  })

  // Regression: sparse header row.
  //
  // A sparse header row, as a sheet starting past column A yields, threw a
  // TypeError in the partial header match.
  it("reads a sparse header row", () => {
    const header: unknown[] = []
    header[1] = "Nama"
    header[2] = "Jumlah"
    const data: unknown[] = []
    data[1] = "Baut"
    data[2] = "2"
    expect(rowsFromAOA([header, data])).toEqual([{ impaCode: "", name: "Baut", qty: 2, unit: "" }])
  })

  it("reads a non-finite numeric quantity as zero", () => {
    expect(parseQty(Number.POSITIVE_INFINITY)).toBe(0)
  })
})

// Fixture workbooks as data URLs.
//
// Written by apps/api/scripts/rfqfixtures (make rfq-fixtures) with excelize,
// so the reader is checked against bytes it did not write itself. The API
// parser reads the same files from its testdata.
const fixtureDir = "../../../../api/internal/quotations/testdata"
const fixtures = import.meta.glob<string>("../../../../api/internal/quotations/testdata/*.xlsx", {
  query: "?inline",
  import: "default",
  eager: true,
})

async function fixtureFile(name: string): Promise<File> {
  const url = fixtures[`${fixtureDir}/${name}`]
  if (!url) throw new Error(`fixture ${name} missing`)
  const buf = await (await fetch(url)).arrayBuffer()
  // Upper-case extension: detection ignores case.
  return new File([buf], name.replace(".xlsx", ".XLSX"))
}

type Case = { file: string; why: string; want: MatchRowInput[] }

const radio = { impaCode: "370115", name: "Marine Radio", qty: 2, unit: "PCS" }
const rope = { impaCode: "210101", name: "Tali Tambang", qty: 5, unit: "MTR" }

const cases: Case[] = [
  {
    file: "multi-sheet.xlsx",
    why: "takes the first sheet that has product rows",
    want: [radio],
  },
  {
    file: "display-values.xlsx",
    why: "reads cached formula results, links and rich text as display text",
    want: [{ impaCode: "370115", name: "Tali Nylon", qty: 6, unit: "ROLL" }],
  },
  // Regression: error cell text.
  //
  // An error cell, such as a failed VLOOKUP, was sent as the text
  // "[object Object]" and matched or created a product by that name.
  {
    file: "error-cells.xlsx",
    why: "reads error cells, plain or cached, as blank",
    want: [{ impaCode: "", name: "Mur", qty: 0, unit: "PCS" }],
  },
  // Regression: uncached formula result.
  //
  // A formula saved without a cached result, as generated workbooks do, was
  // sent as the name "[object Object]".
  {
    file: "uncached-formula.xlsx",
    why: "reads a formula without a cached result as blank",
    want: [{ impaCode: "370115", name: "Mur", qty: 2, unit: "" }],
  },
  // Regression: table past column A.
  //
  // Empty leading cells left holes, and a table starting at column B
  // crashed the header scan with a TypeError.
  {
    file: "offset-table.xlsx",
    why: "reads a table that starts at B3",
    want: [{ impaCode: "", name: "Baut", qty: 2, unit: "" }],
  },
  {
    file: "no-products.xlsx",
    why: "returns nothing for a workbook without product rows",
    want: [],
  },
  // Merged cells: current behaviour.
  //
  // A merged cell's value fills every cell it covers. That lets the
  // two-row header resolve Kode IMPA and Nama under the merged Produk, and
  // it also turns the merged DECK STORES category row into a product row.
  {
    file: "merged-cells.xlsx",
    why: "fills merged cells from their top-left value",
    want: [
      { impaCode: "DECK STORES", name: "DECK STORES", qty: 0, unit: "DECK STORES" },
      radio,
      rope,
    ],
  },
  // Blank rows do not count.
  //
  // The header sits on row 22 behind 20 blank or styled-empty rows, past
  // the 15-row header scan, and is still found.
  {
    file: "empty-rows.xlsx",
    why: "skips blank and styled-empty rows before and between products",
    want: [radio, rope],
  },
  // Leading zeros survive as text.
  //
  // A numeric IMPA code shown as 012345 by a 000000 format reads as 12345.
  {
    file: "numbers-as-text.xlsx",
    why: "reads text numbers in id-ID format and keeps text leading zeros",
    want: [
      { impaCode: "012345", name: "Cat Kapal", qty: 1000, unit: "KG" },
      { impaCode: "12345", name: "Kuas", qty: 2.5, unit: "PCS" },
      { impaCode: "370115", name: "Marine Radio", qty: 4, unit: "SET" },
      { impaCode: "370116", name: "Lampu", qty: 7, unit: "pcs" },
    ],
  },
  {
    file: "headers-nomor.xlsx",
    why: "accepts Nomor, Deskripsi and Kuantitas under a title row",
    want: [{ impaCode: "232001", name: "Sarung Tangan", qty: 12, unit: "PSG" }],
  },
  {
    file: "headers-kode.xlsx",
    why: "accepts padded upper-case Kode, Produk and Unit",
    want: [{ impaCode: "150101", name: "Baut M10", qty: 1500, unit: "PCS" }],
  },
]

describe("parseProductFile", () => {
  it("reads a CSV upload", async () => {
    const file = new File(["Nama,Jumlah,Satuan\nBaut,2,PCS\n"], "produk.CSV")
    await expect(parseProductFile(file)).resolves.toEqual([
      { impaCode: "", name: "Baut", qty: 2, unit: "PCS" },
    ])
  })

  it("has a case for every fixture", () => {
    expect(Object.keys(fixtures).sort()).toEqual(cases.map((c) => `${fixtureDir}/${c.file}`).sort())
  })

  it.each(cases)("$file $why", async ({ file, want }) => {
    await expect(parseProductFile(await fixtureFile(file))).resolves.toEqual(want)
  })
})
