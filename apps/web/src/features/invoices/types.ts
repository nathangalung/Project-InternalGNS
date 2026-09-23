import type { InvoiceStatus } from "@/lib/status"
import type { InvoiceBackendRow, InvoiceBackendStatus } from "@/types/api"

export type { InvoiceStatus }

// Displayed status, cancelled included.
export type InvoiceDisplayStatus = InvoiceStatus | "DIBATALKAN"

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

export const INVOICE_LABEL: Record<InvoiceDisplayStatus, string> = {
  DRAF: "Draf",
  DIKIRIM: "Dikirim",
  DIBAYAR: "Dibayar",
  TERLAMBAT: "Terlambat",
  DIBATALKAN: "Dibatalkan",
}

// Every text colour is at least 4.5:1 on its fill.
export const INVOICE_STATUS_STYLE: Record<InvoiceDisplayStatus, { bg: string; color: string }> = {
  DRAF: { bg: "#FEF3C7", color: "#92400E" },
  DIKIRIM: { bg: "#DBEAFE", color: "#1D4ED8" },
  DIBAYAR: { bg: "#D1FAE5", color: "#047857" },
  TERLAMBAT: { bg: "#FEE2E2", color: "#B91C1C" },
  DIBATALKAN: { bg: "#F1F5F9", color: "#475569" },
}

// Detail payload types.
//
// Kept here, not in types/api.ts, until that shared file is reconciled; the
// shapes follow apps/api/internal/invoices/dto.go.

// One offered move.
export type InvoiceTransition = {
  to: InvoiceBackendStatus
  label: string
  requiresNote: boolean
}

// One stored status change.
export type InvoiceStatusEvent = {
  id: number
  fromStatus: InvoiceBackendStatus
  toStatus: InvoiceBackendStatus
  note?: string
  paymentProofKey?: string
  changedBy: number
  changedAt: string
}

// GET /invoices/{id} and /by-quotation.
export type InvoiceDetail = InvoiceBackendRow & {
  paidAt?: string
  paymentProofKey?: string
  vesselName?: string
  poNumber?: string
  poDate?: string
  companyNpwp?: string
  companyAddress?: string
  companyEmail?: string
  companyCountryCode: string
  companyTkuId?: string
  contactName?: string
  contactEmail?: string
  contactPhone?: string
  replacesInvoiceId?: number
  replacesInvoiceNo?: string
  replacedByInvoiceId?: number
  allowedTransitions: InvoiceTransition[]
  canReplace: boolean
  history: InvoiceStatusEvent[]
}

// PATCH /invoices/{id}/status body.
export type ChangeInvoiceStatusInput = {
  status: InvoiceBackendStatus
  note?: string
  paymentProofKey?: string
}

// PATCH /invoices/{id}/dates body.
export type UpdateInvoiceDatesInput = {
  invoiceDate?: string
  dueDate?: string
}
