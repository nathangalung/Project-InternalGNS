export { CheckIcon as CheckmarkIcon } from "@/components/document/icons"
export {
  dropdownItemStyle,
  dropdownLabelStyle,
  dropdownPanelStyle,
} from "@/components/shared/filter-styles"

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

export function parseRp(v: string): number {
  const n = Number(v.replace(/[^0-9]/g, ""))
  return Number.isFinite(n) ? n : 0
}

export { formatNumber as formatRp } from "@/lib/format"

// Confirm dialog shell (width comes from the caller).
export const confirmOverlayCls =
  "fixed inset-0 z-[9999] flex items-center justify-center bg-[rgba(0,0,0,0.4)]"

export const confirmModalCls =
  "flex w-full flex-col gap-4 rounded-lg bg-white p-6 font-sans shadow-[0_8px_24px_rgba(0,0,0,0.12)]"

export { disabledStyle } from "@/lib/styles"

export function AddNewButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <div className="mt-1 flex justify-end border-t border-[rgba(204,195,216,0.2)] pt-1">
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onClick}
        className="inline-flex items-center gap-1 px-5 py-1 text-caption font-bold text-primary-700"
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
