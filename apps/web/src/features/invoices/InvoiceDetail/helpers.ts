import type { InvoiceBackendRow, InvoiceBackendStatus } from "@/types/api"
import type { InvoiceStatus } from "../types"

// Editor status values. DIBAYAR (paid) is shown but never user-selectable —
// payment is set elsewhere, so it stays out of the manual dropdown order.
export type EditableInvoiceStatus = Extract<
  InvoiceStatus,
  "DRAF" | "DIKIRIM" | "DIBAYAR" | "TERLAMBAT"
>

export const EDITABLE_STATUS_ORDER: EditableInvoiceStatus[] = ["DRAF", "DIKIRIM", "TERLAMBAT"]

// Mirrors InvoiceList deriveStatus exactly.
export function toEditable(inv: InvoiceBackendRow | null | undefined): EditableInvoiceStatus {
  if (!inv) return "DRAF"
  if (inv.status === "paid") return "DIBAYAR"
  if (inv.status === "overdue") return "TERLAMBAT"
  const base: EditableInvoiceStatus = inv.status === "sent" ? "DIKIRIM" : "DRAF"
  if (inv.dueDate) {
    const due = new Date(inv.dueDate)
    if (!Number.isNaN(due.getTime()) && new Date() > due) return "TERLAMBAT"
  }
  return base
}

export const TO_BACKEND: Record<EditableInvoiceStatus, InvoiceBackendStatus> = {
  DRAF: "draft",
  DIKIRIM: "sent",
  DIBAYAR: "paid",
  TERLAMBAT: "overdue",
}
