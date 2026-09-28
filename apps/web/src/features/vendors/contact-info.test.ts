import { describe, expect, it } from "vitest"
import { ApiError } from "@/lib/api-client"
import { EMAIL_ERROR, PHONE_ERROR } from "@/lib/validation"
import { problem } from "@/test/problem"
import { buildContactInfo, vendorFormErrors } from "./contact-info"

describe("buildContactInfo", () => {
  const cases = [
    {
      name: "clears email and phone",
      prev: { email: "a@b.co", phone: "812" },
      email: "",
      phone: " ",
      want: {},
    },
    {
      name: "keeps sku when contacts are cleared",
      prev: { email: "a@b.co", phone: "812", sku: "S-1" },
      email: "",
      phone: "",
      want: { sku: "S-1" },
    },
    {
      name: "trims and replaces values",
      prev: { email: "old@b.co" },
      email: "  new@b.co ",
      phone: "8123",
      want: { email: "new@b.co", phone: "8123" },
    },
    {
      name: "works without previous info",
      prev: undefined,
      email: "x@y.id",
      phone: "",
      want: { email: "x@y.id" },
    },
    {
      name: "treats a null blob as empty",
      prev: null,
      email: "",
      phone: "812",
      want: { phone: "812" },
    },
  ]
  for (const c of cases) {
    it(c.name, () => {
      expect(buildContactInfo(c.prev, c.email, c.phone)).toEqual(c.want)
    })
  }
})

// Server keys onto form inputs.
describe("vendorFormErrors", () => {
  it("maps nested contactInfo keys", () => {
    const err = new ApiError(
      422,
      problem(422, {
        fields: { "contactInfo.phone": PHONE_ERROR, "contactInfo.email": EMAIL_ERROR },
      }),
      `${EMAIL_ERROR}; ${PHONE_ERROR}`,
    )
    expect(vendorFormErrors(err, "gagal")).toEqual({
      fields: { phone: PHONE_ERROR, email: EMAIL_ERROR },
      banner: null,
    })
  })

  it("keeps name and sends the rest to the banner", () => {
    const err = new ApiError(
      422,
      problem(422, { fields: { name: "required", location: "Lain." } }),
      "x",
    )
    expect(vendorFormErrors(err, "gagal")).toEqual({
      fields: { name: "required" },
      banner: "Lain.",
    })
  })

  it("falls back for non-field errors", () => {
    expect(vendorFormErrors(new ApiError(500, null, "Server error"), "gagal")).toEqual({
      fields: {},
      banner: "Server error",
    })
  })
})
