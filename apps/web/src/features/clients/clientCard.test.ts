import { describe, expect, it } from "vitest"
import type { ClientRow, ContactRow } from "@/types/api"
import { clientCardInfo, documentContact, pickedContact } from "./clientCard"

const client: ClientRow = {
  id: 7,
  number: "0007",
  name: "PT Samudra",
  npwp: "0123456789012345",
  address: "Jl. Pelabuhan Raya No. 12",
  email: "kantor@samudra.co.id",
  countryCode: "IDN",
  tkuId: "0123456789012345000000",
  isActive: true,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  contactId: 1,
  contactName: "Budi",
  contactEmail: "budi@samudra.co.id",
  contactPhone: "81200000001",
  totalPurchase: "0",
  quotationCount: 0,
}

const contact = (id: number, over: Partial<ContactRow> = {}): ContactRow => ({
  id,
  companyId: 7,
  name: `Kontak ${id}`,
  countryCode: "IDN",
  isActive: true,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  ...over,
})

const legal = {
  nomorTKU: "0123456789012345000000",
  npwp: "0123456789012345",
  lokasi: "Jl. Pelabuhan Raya No. 12",
}

describe("clientCardInfo", () => {
  it.each([
    {
      name: "the chosen contact gives name, phone and email",
      base: { referenceNumber: "REF-9" },
      picked: { name: "Sari", phone: "81299999999", email: "sari@samudra.co.id" },
      want: {
        referenceNumber: "REF-9",
        narahubung: "Sari",
        phone: "81299999999",
        email: "sari@samudra.co.id",
      },
    },
    {
      name: "a contact without email never shows the company email",
      base: { narahubung: "Sari" },
      picked: { phone: "81299999999" },
      want: { narahubung: "Sari", phone: "81299999999", email: undefined },
    },
    {
      name: "no chosen contact shows none, never the client's first contact",
      base: {},
      picked: undefined,
      want: { narahubung: undefined, phone: undefined, email: undefined },
    },
    {
      name: "the payload name wins over the contact row",
      base: { narahubung: "Sari Lama" },
      picked: { name: "Sari Baru", email: "sari@samudra.co.id" },
      want: { narahubung: "Sari Lama", phone: undefined, email: "sari@samudra.co.id" },
    },
  ])("$name", ({ base, picked, want }) => {
    expect(clientCardInfo(base, client, picked)).toEqual({ ...want, ...legal })
  })

  it("keeps the payload while the client is still loading", () => {
    expect(clientCardInfo({ narahubung: "Sari" }, undefined, undefined)).toEqual({
      narahubung: "Sari",
      phone: undefined,
      email: undefined,
      nomorTKU: undefined,
      npwp: undefined,
      lokasi: undefined,
    })
  })
})

describe("pickedContact", () => {
  const list = [contact(1, { email: "a@x.id" }), contact(2, { phone: "81299999999" })]

  it.each([
    { name: "finds the chosen id", id: 2, want: { name: "Kontak 2", phone: "81299999999" } },
    { name: "no id is no contact", id: undefined, want: undefined },
    { name: "an unlisted id is no contact", id: 5, want: undefined },
  ])("$name", ({ id, want }) => {
    expect(pickedContact(list, id)).toEqual(want)
  })
})

describe("documentContact", () => {
  it.each([
    {
      name: "a stored contact gives its channels",
      d: { contactId: 4, contactEmail: "sari@samudra.co.id", contactPhone: "81299999999" },
      want: { email: "sari@samudra.co.id", phone: "81299999999" },
    },
    { name: "no stored contact is none", d: { contactEmail: "x@y.id" }, want: undefined },
  ])("$name", ({ d, want }) => {
    expect(documentContact(d)).toEqual(want)
  })
})
