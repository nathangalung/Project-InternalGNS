import { describe, expect, it } from "vitest"
import { copyNote, copyRow, matchedCatalog } from "./copyOffer"

describe("copyRow", () => {
  it.each([
    {
      name: "a coded label splits into code and name",
      label: "790268 - LAMPU LED 12W",
      want: { impaCode: "790268", name: "LAMPU LED 12W", qty: 4, unit: "PCS" },
    },
    {
      name: "free text is the name",
      label: "  Oil seal 115-130-12 ",
      want: { impaCode: "", name: "Oil seal 115-130-12", qty: 4, unit: "PCS" },
    },
  ])("$name", ({ label, want }) => {
    expect(copyRow(label, "4", "PCS")).toEqual(want)
  })

  it("an unreadable quantity is zero", () => {
    expect(copyRow("Tali", "", "").qty).toBe(0)
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
  ])("$source", ({ source, want }) => {
    expect(copyNote(source)).toBe(want)
  })
})
