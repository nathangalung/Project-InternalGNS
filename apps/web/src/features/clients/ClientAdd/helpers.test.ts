import { describe, expect, it, vi } from "vitest"
import type { ClientRow } from "@/types/api"
import { INITIAL_FORM, saveClientWithContact } from "./helpers"

describe("saveClientWithContact", () => {
  const form = {
    ...INITIAL_FORM,
    namaPerusahaan: " PT Contoh ",
    alamat: "",
    namaKontak: " Budi ",
    nomorTelepon: " 812345678901 ",
    email: "budi@contoh.co.id",
  }
  const row = { id: 7 } as ClientRow

  function deps(contact: () => Promise<unknown>) {
    return {
      createClient: vi.fn(async () => row),
      createContact: vi.fn(contact),
      onCreated: vi.fn(),
    }
  }

  it("creates the client, then its contact", async () => {
    const d = deps(async () => undefined)
    await expect(saveClientWithContact(form, null, d)).resolves.toBe(row)
    expect(d.createClient).toHaveBeenCalledWith({
      name: "PT Contoh",
      countryCode: "IDN",
      address: undefined,
      email: "budi@contoh.co.id",
      npwp: undefined,
      tkuId: undefined,
    })
    expect(d.onCreated).toHaveBeenCalledWith(row)
    expect(d.createContact).toHaveBeenCalledWith(7, {
      name: "Budi",
      phone: "812345678901",
      email: "budi@contoh.co.id",
      countryCode: "IDN",
    })
  })

  it("reports the client before a contact failure", async () => {
    const d = deps(async () => {
      throw new Error("kontak ditolak")
    })
    await expect(saveClientWithContact(form, null, d)).rejects.toThrow("kontak ditolak")
    expect(d.createClient).toHaveBeenCalledTimes(1)
    expect(d.onCreated).toHaveBeenCalledWith(row)
  })

  it("retries only the contact once the client exists", async () => {
    const d = deps(async () => undefined)
    const existing = { id: 9 } as ClientRow
    await expect(saveClientWithContact(form, existing, d)).resolves.toBe(existing)
    expect(d.createClient).not.toHaveBeenCalled()
    expect(d.onCreated).not.toHaveBeenCalled()
    expect(d.createContact).toHaveBeenCalledWith(9, expect.objectContaining({ name: "Budi" }))
  })
})
