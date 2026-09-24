import { describe, expect, it } from "vitest"
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

  it("tolerates holes and nulls in the header scan", () => {
    const aoa: unknown[][] = []
    aoa[2] = [null, "Nama", "Jumlah"]
    aoa[3] = [null, "Kabel", "7"]
    expect(rowsFromAOA(aoa)).toEqual([{ impaCode: "", name: "Kabel", qty: 7, unit: "" }])
  })

  it("reads a non-finite numeric quantity as zero", () => {
    expect(parseQty(Number.POSITIVE_INFINITY)).toBe(0)
  })
})

// Real ExcelJS workbook round-trip.
async function workbookFile(build: (wb: import("exceljs").Workbook) => void): Promise<File> {
  const { default: ExcelJS } = await import("exceljs")
  const wb = new ExcelJS.Workbook()
  build(wb)
  const buf = await wb.xlsx.writeBuffer()
  return new File([buf], "Daftar.XLSX")
}

describe("parseProductFile", () => {
  it("reads a CSV upload", async () => {
    const file = new File(["Nama,Jumlah,Satuan\nBaut,2,PCS\n"], "produk.CSV")
    await expect(parseProductFile(file)).resolves.toEqual([
      { impaCode: "", name: "Baut", qty: 2, unit: "PCS" },
    ])
  })

  it("takes the first sheet that has product rows", async () => {
    const file = await workbookFile((wb) => {
      wb.addWorksheet("Kosong")
      wb.addWorksheet("Catatan").addRow(["Dikirim ke Batam"])
      const ws = wb.addWorksheet("Produk")
      ws.addRow(["Kode IMPA", "Nama Produk", "Jumlah", "Satuan"])
      ws.addRow(["370115", "Marine Radio", 2, "PCS"])
    })
    await expect(parseProductFile(file)).resolves.toEqual([
      { impaCode: "370115", name: "Marine Radio", qty: 2, unit: "PCS" },
    ])
  })

  it("reads formula results, links, rich text and dates as their display value", async () => {
    const shipped = new Date(Date.UTC(2026, 8, 24))
    const file = await workbookFile((wb) => {
      const ws = wb.addWorksheet("Produk")
      ws.addRow(["Kode", "Nama", "Jumlah", "Satuan", "Tanggal"])
      ws.addRow([
        { formula: "1+1", result: 370115 },
        { text: "Tali Nylon", hyperlink: "https://gns.id/tali" },
        { formula: "2*3", result: 6 },
        { richText: [{ text: "RO" }, { text: "LL" }] },
        shipped,
      ])
    })
    await expect(parseProductFile(file)).resolves.toEqual([
      { impaCode: "370115", name: "Tali Nylon", qty: 6, unit: "ROLL" },
    ])
  })

  // Regression: an error cell, such as a failed VLOOKUP, was sent as the
  // text "[object Object]" and matched or created a product by that name.
  it("reads an error cell as blank", async () => {
    const file = await workbookFile((wb) => {
      const ws = wb.addWorksheet("Produk")
      ws.addRow(["Kode", "Nama", "Jumlah", "Satuan"])
      ws.addRow([{ error: "#N/A" }, "Mur", { formula: "1/0", result: { error: "#DIV/0!" } }, "PCS"])
      ws.addRow(["370115", { formula: "VLOOKUP(A3,K:L,2,0)", result: { error: "#N/A" } }, 2, "PCS"])
    })
    await expect(parseProductFile(file)).resolves.toEqual([
      { impaCode: "", name: "Mur", qty: 0, unit: "PCS" },
    ])
  })

  // Regression: a formula saved without a cached result, as generated
  // workbooks do, was sent as the name "[object Object]".
  it("reads a formula without a cached result as blank", async () => {
    const file = await workbookFile((wb) => {
      const ws = wb.addWorksheet("Produk")
      ws.addRow(["Kode", "Nama", "Jumlah"])
      ws.addRow([{ formula: "K1" }, { formula: "VLOOKUP(A2,K:L,2,0)" }, 1])
      ws.addRow(["370115", "Mur", 2])
    })
    await expect(parseProductFile(file)).resolves.toEqual([
      { impaCode: "370115", name: "Mur", qty: 2, unit: "" },
    ])
  })

  // Regression: ExcelJS leaves holes for empty cells, and a table starting
  // at column B crashed the header scan with a TypeError.
  it("reads a table that starts past column A", async () => {
    const file = await workbookFile((wb) => {
      const ws = wb.addWorksheet("Produk")
      ws.getCell("B1").value = "Nama"
      ws.getCell("C1").value = "Jumlah"
      ws.getCell("B2").value = "Baut"
      ws.getCell("C2").value = 2
    })
    await expect(parseProductFile(file)).resolves.toEqual([
      { impaCode: "", name: "Baut", qty: 2, unit: "" },
    ])
  })

  it("returns nothing for a workbook without product rows", async () => {
    const file = await workbookFile((wb) => {
      wb.addWorksheet("Catatan").addRow(["Tidak ada produk"])
    })
    await expect(parseProductFile(file)).resolves.toEqual([])
  })
})
