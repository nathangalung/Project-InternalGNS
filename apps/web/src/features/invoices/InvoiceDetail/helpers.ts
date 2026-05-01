import type { InvoiceStatus } from "../types"

// Manual status options (Dibayar is set via payment flow, Terlambat is auto-derived).
export type EditableInvoiceStatus = Extract<InvoiceStatus, "DRAF" | "DIKIRIM" | "TERLAMBAT">

export const EDITABLE_STATUS_ORDER: EditableInvoiceStatus[] = ["DRAF", "DIKIRIM", "TERLAMBAT"]
