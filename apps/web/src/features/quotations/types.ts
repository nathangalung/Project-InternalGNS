import type { DisplayStatus } from "@/lib/status"

export type Status = DisplayStatus

export interface ClientInfo {
  narahubung?: string
  phone?: string
  email?: string
  nomorTKU?: string
  referenceNumber?: string
  npwp?: string
  lokasi?: string
}

export interface ProductRow {
  kode: string
  nama: string
  requestedKode?: string
  requestedNama?: string
  qty: number
  satuan: string
  hargaSatuan: number
  profitSatuan: number
  vendor?: string
}

export interface ShippingRow {
  nama: string
  deadline: string
  hargaSatuan: number
  alamat?: string
  hari?: number
}

interface HistoryEntry {
  date: string
  action: string
}

export interface QuotationData {
  id: string
  version: number
  client: string
  clientInfo?: ClientInfo
  createdAt: string
  status: Status
  totalBayar: number
  subtotal: number
  dppNilaiLain: number
  ppnAmount: number
  totalDiscount: number
  discountPct?: number
  products: ProductRow[]
  shipping: ShippingRow
  history: HistoryEntry[]
}
