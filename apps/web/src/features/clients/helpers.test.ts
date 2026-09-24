import { describe, expect, it } from "vitest"
import type { ClientRow, ClientSearchHit } from "@/types/api"
import {
  clientKpis,
  contactUpdateBody,
  dedupeByCompany,
  fromClientHit,
  fromClientRow,
  getCompanyInitials,
} from "./helpers"

describe("clientKpis", () => {
  it("measures growth against the base at the start of the year", () => {
    // 40 existed before January, 10 joined since: the base grew 25%.
    const k = clientKpis({
      total: 50,
      activeCount: 45,
      newThisMonth: 2,
      newThisYear: 10,
      prevYearTotal: 40,
    })
    expect(k.growth).toBe("+25%")
    expect(k.activeShare).toBe("90%")
    expect(k.total).toBe(50)
    expect(k.newThisMonth).toBe(2)
  })

  it("never reports shrinkage when only new clients are counted", () => {
    // Regression: the old formula subtracted the cumulative base from a
    // one-year count and printed -75% for a growing client base.
    const k = clientKpis({
      total: 50,
      activeCount: 50,
      newThisMonth: 0,
      newThisYear: 10,
      prevYearTotal: 40,
    })
    expect(k.growth.startsWith("-")).toBe(false)
  })

  it("shows a dash without a base or data", () => {
    expect(clientKpis(undefined)).toEqual({
      total: 0,
      growth: "-",
      newThisMonth: 0,
      activeShare: "-",
    })
    const k = clientKpis({
      total: 3,
      activeCount: 1,
      newThisMonth: 3,
      newThisYear: 3,
      prevYearTotal: 0,
    })
    expect(k.growth).toBe("-")
    expect(k.activeShare).toBe("33%")
  })
})

describe("contactUpdateBody", () => {
  it("sends blank email and title as empty strings so they clear", () => {
    // Regression MD-06: dropping the keys kept the stored values.
    const body = contactUpdateBody({ name: " Budi ", phone: "", email: "  ", title: "" }, "IDN")
    expect(body).toEqual({
      name: "Budi",
      phone: undefined,
      email: "",
      title: "",
      countryCode: "IDN",
    })
    expect("email" in body && "title" in body).toBe(true)
  })

  it("trims filled values and keeps the country", () => {
    expect(
      contactUpdateBody(
        { name: "Sari", phone: " 0812 ", email: " sari@a.co ", title: " Manajer " },
        "SGP",
      ),
    ).toEqual({
      name: "Sari",
      phone: "0812",
      email: "sari@a.co",
      title: "Manajer",
      countryCode: "SGP",
    })
  })
})

describe("getCompanyInitials", () => {
  it.each<[string, string]>([
    ["PT Global Niaga Sakti", "GN"],
    ["PT. Samudera", "SA"],
    ["pt maju jaya", "MJ"],
    ["CV Baja", "CB"],
    ["Pertamina", "PE"],
    ["   ", "?"],
  ])("%s -> %s", (name, want) => {
    expect(getCompanyInitials(name)).toBe(want)
  })
})

const row: ClientRow = {
  id: 7,
  number: "C-007",
  name: "PT Laut Biru",
  npwp: "01.234",
  address: "Jakarta",
  email: "info@laut.id",
  countryCode: "ID",
  tkuId: "TKU1",
  isActive: true,
  createdAt: "",
  updatedAt: "",
  contactId: 3,
  contactName: "Budi",
  contactEmail: "budi@laut.id",
  contactPhone: "0812",
  totalPurchase: "0",
  quotationCount: 0,
}

const hit: ClientSearchHit = {
  companyId: 7,
  companyName: "PT Laut Biru",
  companyNumber: "C-007",
  companyNpwp: "01.234",
  companyAddress: "Jakarta",
  companyEmail: "info@laut.id",
  companyCountry: "ID",
  companyTku: "TKU1",
  contactId: 3,
  contactName: "Budi",
  contactEmail: "budi@laut.id",
  contactPhone: "0812",
  score: 1,
  matchTier: "AUTO_MATCH",
}

describe("client picker cards", () => {
  const card = {
    id: "7",
    name: "PT Laut Biru",
    narahubung: "Budi",
    country: "ID",
    initials: "LB",
    phone: "0812",
    email: "budi@laut.id",
    npwp: "01.234",
    nomorTKU: "TKU1",
    referenceNumber: "C-007",
    lokasi: "Jakarta",
    contactId: 3,
  }

  it("builds the same card from a list row and a search hit", () => {
    expect(fromClientRow(row)).toEqual(card)
    expect(fromClientHit(hit)).toEqual(card)
  })

  it("falls back to the company email and a blank contact without a contact", () => {
    const bare = { contactId: undefined, contactName: undefined, contactEmail: undefined }
    expect(fromClientRow({ ...row, ...bare })).toMatchObject({
      narahubung: "",
      email: "info@laut.id",
      contactId: undefined,
    })
    expect(fromClientHit({ ...hit, ...bare })).toMatchObject({
      narahubung: "",
      email: "info@laut.id",
      contactId: undefined,
    })
  })
})

describe("dedupeByCompany", () => {
  it("keeps the first, best-ranked hit per company in order", () => {
    const hits = [
      { ...hit, companyId: 1, contactId: 10 },
      { ...hit, companyId: 2, contactId: 20 },
      { ...hit, companyId: 1, contactId: 11 },
    ]
    expect(dedupeByCompany(hits).map((h) => [h.companyId, h.contactId])).toEqual([
      [1, 10],
      [2, 20],
    ])
  })

  it("returns nothing for no hits", () => {
    expect(dedupeByCompany([])).toEqual([])
  })
})
