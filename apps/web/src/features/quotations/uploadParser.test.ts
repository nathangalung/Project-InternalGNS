import { describe, expect, it } from "vitest"
import { parseCsv, parseQty, rowsFromAOA } from "./uploadParser"

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
