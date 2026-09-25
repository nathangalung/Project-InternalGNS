import { ui } from "@/lib/ui"

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

export function isValidPhone(s: string): boolean {
  const digits = s.replace(/[^0-9]/g, "")
  return digits.length >= 9 && digits.length <= 13
}
