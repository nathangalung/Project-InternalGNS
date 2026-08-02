import { ui } from "@/lib/ui"

export { CheckIcon as CheckmarkIcon } from "@/components/document/icons"
export {
  dropdownItemStyle,
  dropdownLabelStyle,
  dropdownPanelStyle,
} from "@/components/shared/filter-styles"

// Field class strings, ported from ca-*.
export const optionalCls = "text-overline font-normal italic text-dark-600"

export const fieldErrorCls = "mt-1 block text-xs text-[#EF4444]"

export const inputCls = `${ui.fieldInput} font-sans placeholder:text-dark-500 ${ui.disabledField}`

export interface ClientAddFormData {
  namaPerusahaan: string
  kodeNegara: string
  alamat: string
  logo: string // data URL for preview only (not yet persisted)
  namaKontak: string
  nomorTelepon: string
  email: string
  npwp: string
  tku: string
  referenceNumber: string
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
  referenceNumber: "",
}

export function isValidAddress(s: string): boolean {
  const t = s.trim()
  return t.length >= 20 && /[a-zA-Z]/.test(t)
}

export function isValidEmail(s: string): boolean {
  return s.includes("@") && s.split("@").length === 2 && s.split("@")[1].includes(".")
}

export function isValidPhone(s: string): boolean {
  const digits = s.replace(/[^0-9]/g, "")
  return digits.length >= 9 && digits.length <= 13
}
