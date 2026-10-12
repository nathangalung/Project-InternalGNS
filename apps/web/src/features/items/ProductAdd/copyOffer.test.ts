import { describe, expect, it } from "vitest"
import { copyNote, copyRow, matchedCatalog } from "./copyOffer"

describe("copyRow", () => {
  it.each([
    {
      name: "the code and the name stay apart",
      kode: "790268",
      nama: "LAMPU LED 12W",
      want: { impaCode: "790268", name: "LAMPU LED 12W", qty: 4, unit: "PCS" },
    },
    {
      name: "a marked code is sent as its six digits",
      kode: " IMPA 790268 ",
      nama: "LAMPU LED 12W",
      want: { impaCode: "790268", name: "LAMPU LED 12W", qty: 4, unit: "PCS" },
    },
    {
      name: "no code is matched by name",
      kode: "-",
      nama: "  Oil seal 115-130-12 ",
      want: { impaCode: "", name: "Oil seal 115-130-12", qty: 4, unit: "PCS" },
    },
  ])("$name", ({ kode, nama, want }) => {
    expect(copyRow(kode, nama, "4", "PCS")).toEqual(want)
  })

  it("an unreadable quantity is zero", () => {
    expect(copyRow("", "Tali", "x", "").qty).toBe(0)
  })
})

describe("matchedCatalog", () => {
  it("keeps the id, code, name and unit", () => {
    expect(
      matchedCatalog({ itemId: 9, itemName: "TALI", impaCode: "123456", defaultUnitId: 3 }),
    ).toEqual({ id: 9, kode: "123456", nama: "TALI", defaultUnitId: 3 })
  })

  it("an item without a code has an empty one", () => {
    expect(matchedCatalog({ itemId: 9, itemName: "TALI" }).kode).toBe("")
  })
})

describe("copyNote", () => {
  it.each([
    { source: "CREATED", want: "Produk baru ditambahkan ke katalog." },
    { source: "IMPA_EXACT", want: "Memakai produk katalog yang sama." },
    { source: "LEARNED_EXACT", want: "Memakai produk katalog yang sama." },
    {
      source: "CATALOG_MATCH",
      want: "Memakai produk katalog yang paling mirip. Periksa sebelum disimpan.",
    },
  ])("$source", ({ source, want }) => {
    expect(copyNote(source)).toBe(want)
  })
})
