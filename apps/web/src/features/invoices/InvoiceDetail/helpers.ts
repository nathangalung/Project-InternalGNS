import { deriveInvoiceStatus } from "@/lib/status"
import type { InvoiceBackendRow, InvoiceBackendStatus } from "@/types/api"
import type { InvoiceStatus } from "../types"

// Editor status values. DIBAYAR (paid) is shown but never user-selectable —
// payment is set elsewhere, so it stays out of the manual dropdown order.
export type EditableInvoiceStatus = Extract<
  InvoiceStatus,
  "DRAF" | "DIKIRIM" | "DIBAYAR" | "TERLAMBAT"
>

export const EDITABLE_STATUS_ORDER: EditableInvoiceStatus[] = ["DRAF", "DIKIRIM", "TERLAMBAT"]

// Shared derivation, cancelled kept visible.
export function toEditable(inv: InvoiceBackendRow | null | undefined): EditableInvoiceStatus {
  return deriveInvoiceStatus(inv)
}

export const TO_BACKEND: Record<EditableInvoiceStatus, InvoiceBackendStatus> = {
  DRAF: "draft",
  DIKIRIM: "sent",
  DIBAYAR: "paid",
  TERLAMBAT: "overdue",
}
