import { describe, expect, it } from "vitest"
import type { CountryRow } from "@/types/api"
import { matchCountries } from "./match"

const countries: CountryRow[] = [
  { code: "IDN", name: "Indonesia", dialCode: "+62" },
  { code: "IND", name: "India", dialCode: "+91" },
  { code: "IOT", name: "British Indian Ocean Territory", dialCode: "+246" },
  { code: "SGP", name: "Singapore", dialCode: "+65" },
  { code: "MYS", name: "Malaysia", dialCode: "+60" },
  { code: "JPN", name: "Japan", dialCode: "+81" },
]

describe("matchCountries", () => {
  it.each([
    ["blank keeps the head", "", ["IDN", "IND", "IOT", "SGP", "MYS"]],
    ["name, any case", "indo", ["IDN"]],
    ["code", "sgp", ["SGP"]],
    ["name inside", "indian", ["IOT"]],
    ["trimmed", " jap ", ["JPN"]],
    ["none", "zz", []],
  ])("%s", (_, query, codes) => {
    expect(matchCountries(countries, query).map((c) => c.code)).toEqual(codes)
  })

  it("honours the limit", () => {
    expect(matchCountries(countries, "", 2)).toHaveLength(2)
  })
})
