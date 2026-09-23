import type { InvoiceStatus } from "@/lib/status"

export type { InvoiceStatus }

export type InvoiceRow = {
  id: number
  quotationId: number
  companyClientId: number
  invoiceNo: string
  client: string
  createdAt: string // ISO
  dueDate: string // ISO
  total: string // formatted Rp
  totalNumber: number
  status: InvoiceStatus
}

export const INVOICE_LABEL: Record<InvoiceStatus, string> = {
  DRAF: "Draf",
  DIKIRIM: "Dikirim",
  DIBAYAR: "Dibayar",
  TERLAMBAT: "Terlambat",
}

// Every text colour is at least 4.5:1 on its fill.
export const INVOICE_STATUS_STYLE: Record<InvoiceStatus, { bg: string; color: string }> = {
  DRAF: { bg: "#FEF3C7", color: "#92400E" },
  DIKIRIM: { bg: "#DBEAFE", color: "#1D4ED8" },
  DIBAYAR: { bg: "#D1FAE5", color: "#047857" },
  TERLAMBAT: { bg: "#FEE2E2", color: "#B91C1C" },
}
