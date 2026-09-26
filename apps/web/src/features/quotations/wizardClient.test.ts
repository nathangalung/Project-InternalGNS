import { describe, expect, it } from "vitest"
import type { ClientRow } from "@/types/api"
import { type PickClient, resolveClient, visibleClients } from "./wizardClient"

function pick(id: string, name = `Klien ${id}`): PickClient {
  return { id, name, narahubung: "", country: "ID", initials: "KL" }
}

function row(id: number, number: string): ClientRow {
  return {
    id,
    number,
    name: "PT Baru Sekali",
    countryCode: "ID",
    isActive: true,
    createdAt: "2026-09-01T00:00:00Z",
    updatedAt: "2026-09-01T00:00:00Z",
    contactId: 77,
    contactName: "Budi",
    totalPurchase: "0",
    quotationCount: 0,
  }
}

describe("resolveClient", () => {
  const listed = [pick("1"), pick("2")]

  it("prefers the listed client", () => {
    expect(resolveClient(listed, "2", row(2, "C-2"))).toBe(listed[1])
  })

  it("falls back to the fetched row", () => {
    const got = resolveClient(listed, "99", row(99, "C-99"))
    expect(got?.id).toBe("99")
    expect(got?.referenceNumber).toBe("C-99")
    expect(got?.narahubung).toBe("Budi")
    expect(got?.contactId).toBe(77)
  })

  it("ignores a row for another client", () => {
    expect(resolveClient(listed, "99", row(98, "C-98"))).toBeUndefined()
  })

  it("is empty with nothing selected", () => {
    expect(resolveClient(listed, "", row(1, "C-1"))).toBeUndefined()
  })
})

describe("visibleClients", () => {
  const sorted = [pick("1"), pick("2"), pick("3")]

  it("keeps the first rows when the selection is among them", () => {
    expect(visibleClients(sorted, sorted[1], 2).map((c) => c.id)).toEqual(["1", "2"])
  })

  it("pins a selection outside the rows", () => {
    expect(visibleClients(sorted, pick("9"), 2).map((c) => c.id)).toEqual(["9", "1"])
  })

  it("returns the first rows with no selection", () => {
    expect(visibleClients(sorted, undefined, 2).map((c) => c.id)).toEqual(["1", "2"])
  })
})
