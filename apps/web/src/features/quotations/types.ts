import type { QuotationStatusLabel } from "./status"

export type Status = QuotationStatusLabel

export type ClientInfo = {
  narahubung?: string
  phone?: string
  email?: string
  nomorTKU?: string
  referenceNumber?: string
  npwp?: string
  lokasi?: string
}

export type ProductRow = {
  // Offered or requested catalog item
  itemId?: number
  // Stable line key
  lineId?: number
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

export type ShippingRow = {
  nama: string
  deadline: string
  hargaSatuan: number
  alamat?: string
  hari?: number
}

type HistoryEntry = {
  date: string
  action: string
}

export type QuotationData = {
  id: string
  version: number
  client: string
  clientId?: number
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
