import type * as clientsApi from "@/features/clients/api"
import { ui } from "@/lib/ui"
import type { ClientRow } from "@/types/api"

export { CheckIcon as CheckmarkIcon } from "@/components/document/icons"

// Field class strings.
//
// Ported from ca-*.
export const optionalCls = "text-overline font-normal uppercase italic text-dark-600"

export const fieldErrorCls = "mt-1 block text-xs text-[#EF4444]"

export const fieldHintCls = "mt-1 block text-xs text-dark-600"

export const inputCls = `${ui.fieldInput} font-sans placeholder:text-dark-500 ${ui.disabledField}`

export type ClientAddFormData = {
  namaPerusahaan: string
  kodeNegara: string
  alamat: string
  // Preview data URL; the file uploads after save.
  logo: string
  namaKontak: string
  nomorTelepon: string
  email: string
  npwp: string
  tku: string
}

export const INITIAL_FORM: ClientAddFormData = {
  namaPerusahaan: "",
  kodeNegara: "IDN",
  alamat: "",
  logo: "",
  namaKontak: "",
  nomorTelepon: "",
  email: "",
  npwp: "",
  tku: "",
}

export const ADDRESS_ERROR = "Alamat harus minimal 20 karakter dan mengandung huruf."

export function isValidAddress(s: string): boolean {
  const t = s.trim()
  return t.length >= 20 && /[a-zA-Z]/.test(t)
}

// Optional address, checked once filled.
//
// The quotation may go out without one; the PO gate asks for it before the
// work starts.
export function optionalAddressError(s: string): string | null {
  return s.trim() === "" || isValidAddress(s) ? null : ADDRESS_ERROR
}

export function isValidEmail(s: string): boolean {
  return s.includes("@") && s.split("@").length === 2 && s.split("@")[1].includes(".")
}

// Matches company_contacts_phone_check.
export const PHONE_ERROR = "Nomor telepon harus 9–12 digit angka."

export function isValidPhone(s: string): boolean {
  const digits = s.replace(/[^0-9]/g, "")
  return digits.length >= 9 && digits.length <= 12
}

type SaveClientDeps = {
  createClient: (input: Parameters<typeof clientsApi.create>[0]) => Promise<ClientRow>
  createContact: (
    companyId: number,
    input: Parameters<typeof clientsApi.createContact>[1],
  ) => Promise<unknown>
  onCreated: (created: ClientRow) => void
}

// Client, then its first contact.
//
// onCreated fires before the contact call, so a caller that keeps the row
// retries only the contact instead of creating a second client.
export async function saveClientWithContact(
  form: ClientAddFormData,
  existing: ClientRow | null,
  deps: SaveClientDeps,
): Promise<ClientRow> {
  const countryCode = form.kodeNegara || "IDN"
  let client = existing
  if (!client) {
    client = await deps.createClient({
      name: form.namaPerusahaan.trim(),
      countryCode,
      address: form.alamat.trim() || undefined,
      email: form.email.trim() || undefined,
      npwp: form.npwp.trim() || undefined,
      tkuId: form.tku.trim() || undefined,
    })
    deps.onCreated(client)
  }
  await deps.createContact(client.id, {
    name: form.namaKontak.trim(),
    phone: form.nomorTelepon.trim() || undefined,
    email: form.email.trim() || undefined,
    countryCode,
  })
  return client
}
