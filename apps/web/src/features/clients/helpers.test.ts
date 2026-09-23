import { describe, expect, it } from "vitest"
import { clientKpis, contactUpdateBody } from "./helpers"

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
