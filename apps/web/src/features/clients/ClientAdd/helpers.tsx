import { ui } from "@/lib/ui"

export { CheckIcon as CheckmarkIcon } from "@/components/document/icons"
export {
  dropdownItemStyle,
  dropdownLabelStyle,
  dropdownPanelStyle,
} from "@/components/shared/filter-styles"

// Visual disabled treatment, matching lib/styles disabledStyle.
const disabledCls = "disabled:cursor-not-allowed disabled:bg-[#F7F7F8] disabled:opacity-60"

// Field class strings, ported from ca-*.
export const optionalCls = "text-overline font-normal italic text-dark-600"

export const fieldErrorCls = "mt-1 block text-xs text-[#EF4444]"

export const inputCls = `${ui.fieldInput} font-sans placeholder:text-dark-500 ${disabledCls}`

export const selectBtnCls = `flex w-full items-center justify-between rounded-md border-[1.5px] border-transparent bg-dark-200 px-4 py-3 font-sans text-sm font-normal text-dark-900 outline-none transition focus:border-primary-600 focus:shadow-[0_0_0_3px_rgba(124,58,237,0.12)] ${disabledCls}`

// Phone input group, ported from ca-phone-*.
export const phoneWrapCls =
  "flex h-11 overflow-hidden rounded-md border-[1.5px] border-transparent bg-dark-200 transition focus-within:border-primary-600 focus-within:shadow-[0_0_0_3px_rgba(124,58,237,0.12)]"

export const phonePrefixCls =
  "flex items-center whitespace-nowrap border-r border-dark-300 px-3 text-sm font-medium text-dark-600"

export const phoneInputCls = `min-w-0 flex-1 border-0 bg-transparent px-3 font-sans text-sm text-dark-900 outline-none placeholder:text-dark-500 ${disabledCls}`

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
