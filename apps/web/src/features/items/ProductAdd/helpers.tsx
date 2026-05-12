import type { CSSProperties } from "react"

export interface ProductAddFormData {
  requestedKodeImpaNama: string
  kodeImpaNama: string
  jumlahProduk: string
  satuan: string
  namaVendor: string
  hargaBeli: string
  hargaJual: string
  itemId?: number
  requestedItemId?: number
  vendorProductId?: number
  vendorId?: number
}

// Persisted row hydrated back into form fields.
export interface ProductAddInitialData {
  kodeImpa: string
  nama: string
  requestedKodeImpa?: string
  requestedNama?: string
  jumlah: number
  satuan: string
  vendor: string
  hargaBeli: number
  hargaJual: number
  itemId?: number
  requestedItemId?: number
  vendorId?: number
  vendorProductId?: number
}

export interface VendorOption {
  nama: string
  harga: number
  vendorId?: number
  vendorProductId?: number
}

export interface HistorisOption {
  keterangan: string
  harga: number
}

export interface CatalogItem {
  id?: number
  kode: string
  nama: string
  defaultUnitId?: number
}

export interface NewVendorForm {
  nama: string
  harga: string
}

export type DropdownKey = "product" | "productRequest" | "satuan" | "vendor" | "historis"

// IMPA-name label, drops missing kode.
export function formatKodeNama(kode: string | undefined | null, nama: string): string {
  return kode && kode.trim().length > 0 ? `${kode} - ${nama}` : nama
}

export const INITIAL_FORM: ProductAddFormData = {
  requestedKodeImpaNama: "",
  kodeImpaNama: "",
  jumlahProduk: "",
  satuan: "",
  namaVendor: "",
  hargaBeli: "",
  hargaJual: "",
}

// "550101 - Air Filter" → { kode: "550101", nama: "Air Filter" }; "Air Filter" → { kode: "", nama: "Air Filter" }.
export function splitKodeNama(combined: string): { kode: string; nama: string } {
  const trimmed = combined.trim()
  if (!trimmed) return { kode: "", nama: "" }
  const [first, ...rest] = trimmed.split(/\s*-\s*/)
  if (rest.length > 0 && /^\d+$/.test(first)) {
    return { kode: first, nama: rest.join(" - ") }
  }
  return { kode: "", nama: trimmed }
}

export function parseRp(v: string): number {
  const n = Number(v.replace(/[^0-9]/g, ""))
  return Number.isFinite(n) ? n : 0
}

export { formatNumber as formatRp } from "@/lib/format"

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

export const confirmOverlayStyle: CSSProperties = {
  position: "fixed",
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  background: "rgba(0, 0, 0, 0.4)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 9999,
}

export const confirmModalStyle: CSSProperties = {
  background: "#FFFFFF",
  borderRadius: "12px",
  padding: "24px",
  width: "100%",
  maxWidth: "400px",
  boxShadow: "0 8px 24px rgba(0, 0, 0, 0.12)",
  fontFamily: "'Inter', sans-serif",
  display: "flex",
  flexDirection: "column",
  gap: "16px",
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

export function AddNewButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <div
      style={{
        borderTop: "1px solid rgba(204, 195, 216, 0.2)",
        marginTop: 4,
        paddingTop: 4,
        display: "flex",
        justifyContent: "flex-end",
      }}
    >
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onClick}
        style={{
          padding: "4px 20px",
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          background: "transparent",
          border: "none",
          cursor: "pointer",
          fontFamily: "'Inter', sans-serif",
          fontWeight: 700,
          fontSize: "12px",
          lineHeight: "16px",
          color: "#630ED4",
        }}
      >
        <svg width="9" height="9" viewBox="0 0 9 9" fill="none" xmlns="http://www.w3.org/2000/svg">
          <line
            x1="4.5"
            y1="1"
            x2="4.5"
            y2="8"
            stroke="#630ED4"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
          <line
            x1="1"
            y1="4.5"
            x2="8"
            y2="4.5"
            stroke="#630ED4"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
        {label}
      </button>
    </div>
  )
}
