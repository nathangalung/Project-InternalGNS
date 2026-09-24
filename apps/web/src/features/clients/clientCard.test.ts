import { describe, expect, it } from "vitest"
import type { ClientRow, ContactRow } from "@/types/api"
import { clientCardInfo } from "./clientCard"

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

describe("clientCardInfo", () => {
  it.each([
    {
      name: "the document's contact gives phone and email",
      contacts: [contact(1), contact(2, { phone: "81299999999", email: "sari@samudra.co.id" })],
      contactId: 2,
      base: { narahubung: "Sari", referenceNumber: "REF-9" },
      want: {
        narahubung: "Sari",
        referenceNumber: "REF-9",
        phone: "81299999999",
        email: "sari@samudra.co.id",
      },
    },
    {
      name: "a contact without email falls back to the company email",
      contacts: [contact(2, { phone: "81299999999" })],
      contactId: 2,
      base: { narahubung: "Sari" },
      want: { narahubung: "Sari", phone: "81299999999", email: "kantor@samudra.co.id" },
    },
    {
      name: "a payload without the contact name takes it from the contact",
      contacts: [contact(2, { phone: "81299999999", email: "sari@samudra.co.id" })],
      contactId: 2,
      base: {},
      want: { narahubung: "Kontak 2", phone: "81299999999", email: "sari@samudra.co.id" },
    },
    {
      name: "no document contact uses the client's primary contact",
      contacts: [],
      contactId: undefined,
      base: {},
      want: { narahubung: "Budi", phone: "81200000001", email: "budi@samudra.co.id" },
    },
    {
      name: "a document contact that is gone never borrows another's phone",
      contacts: [contact(1, { phone: "81200000001" })],
      contactId: 5,
      base: { narahubung: "Lama" },
      want: { narahubung: "Lama", phone: undefined, email: "kantor@samudra.co.id" },
    },
  ])("$name", ({ contacts, contactId, base, want }) => {
    expect(clientCardInfo(base, client, contacts, contactId)).toEqual({
      ...want,
      nomorTKU: "0123456789012345000000",
      npwp: "0123456789012345",
      lokasi: "Jl. Pelabuhan Raya No. 12",
    })
  })

  it("keeps the payload while the client is still loading", () => {
    expect(clientCardInfo({ narahubung: "Sari" }, undefined, undefined, 2)).toEqual({
      narahubung: "Sari",
      phone: undefined,
      email: undefined,
      nomorTKU: undefined,
      npwp: undefined,
      lokasi: undefined,
    })
  })
})
