import { describe, expect, it, vi } from "vitest"
import type { ClientRow } from "@/types/api"
import {
  ADDRESS_ERROR,
  INITIAL_FORM,
  isValidAddress,
  isValidPhone,
  optionalAddressError,
  PHONE_ERROR,
  saveClientWithContact,
} from "./helpers"

describe("isValidAddress", () => {
  it.each<[string, boolean]>([
    ["Jl. Pelabuhan No. 12, Jakarta Utara", true],
    ["  Jl. Pelabuhan No. 12, Jakarta  ", true],
    ["Jl. Pendek", false],
    ["12345678901234567890", false],
    ["", false],
  ])("%j -> %s", (s, ok) => {
    expect(isValidAddress(s)).toBe(ok)
  })
})

describe("optionalAddressError", () => {
  it.each<[string, string | null]>([
    ["", null],
    ["   ", null],
    ["Jl. Pelabuhan No. 12, Jakarta Utara", null],
    ["Jl. Pendek", ADDRESS_ERROR],
    ["12345678901234567890", ADDRESS_ERROR],
  ])("%j -> %j", (s, want) => {
    expect(optionalAddressError(s)).toBe(want)
  })

  it("names the rule in Indonesian", () => {
    expect(ADDRESS_ERROR).toBe("Alamat harus minimal 20 karakter dan mengandung huruf.")
  })
})

// Mirrors company_contacts_phone_check: 9 to 12 digits.
describe("isValidPhone", () => {
  it.each<[string, boolean]>([
    ["81234567", false],
    ["812345678", true],
    ["812345678901", true],
    ["8123456789012", false],
    ["+62 812-3456-789", true],
    ["+62 812-3456-7890", false],
    ["", false],
  ])("%j -> %s", (s, ok) => {
    expect(isValidPhone(s)).toBe(ok)
  })

  it("names the rule in Indonesian", () => {
    expect(PHONE_ERROR).toBe("Nomor telepon harus 9–12 digit angka.")
  })
})

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
