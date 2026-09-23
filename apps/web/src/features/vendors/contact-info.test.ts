import { describe, expect, it } from "vitest"
import { buildContactInfo } from "./contact-info"

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
