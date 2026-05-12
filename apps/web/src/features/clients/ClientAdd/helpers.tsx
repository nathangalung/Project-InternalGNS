import type { CSSProperties } from "react"

export const dropdownPanelStyle: CSSProperties = {
  position: "absolute",
  top: "calc(100% + 4px)",
  left: 0,
  right: 0,
  background: "#FFFFFF",
  border: "1px solid rgba(204, 195, 216, 0.2)",
  boxShadow: "0 4px 12px rgba(0, 0, 0, 0.08)",
  borderRadius: "8px",
  display: "flex",
  flexDirection: "column",
  padding: "8px 0",
  zIndex: 50,
}

export const dropdownItemStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
  padding: "10px 20px",
  width: "100%",
  background: "transparent",
  border: "none",
  cursor: "pointer",
  textAlign: "left",
}

export function dropdownLabelStyle(active: boolean): CSSProperties {
  return {
    fontFamily: "'Inter', sans-serif",
    fontWeight: active ? 700 : 500,
    fontSize: "14px",
    lineHeight: "20px",
    color: active ? "#630ED4" : "#4A4455",
  }
}

export const disabledStyle: CSSProperties = {
  opacity: 0.6,
  cursor: "not-allowed",
  backgroundColor: "#F7F7F8",
}

export const CheckmarkIcon = () => (
  <svg width="14" height="11" viewBox="0 0 14 11" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M1 5.5L4.5 9L13 1"
      stroke="#630ED4"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)

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
