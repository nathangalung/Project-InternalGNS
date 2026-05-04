import type { InvoiceStatus } from "../types"

// Editor manual status options.
export type EditableInvoiceStatus = Extract<InvoiceStatus, "DRAF" | "DIKIRIM" | "TERLAMBAT">

export const EDITABLE_STATUS_ORDER: EditableInvoiceStatus[] = ["DRAF", "DIKIRIM", "TERLAMBAT"]
