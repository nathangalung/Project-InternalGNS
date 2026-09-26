import type { ClientInfo } from "@/features/quotations/types"
import { deriveInvoiceStatus } from "@/lib/status"
import type {
  InvoiceBackendRow,
  InvoiceBackendStatus,
  InvoiceDetail,
  InvoiceTransition,
} from "@/types/api"
import type { InvoiceDisplayStatus } from "../types"

// Badge status, cancelled kept visible.
export function invoiceDisplayStatus(inv: InvoiceBackendRow): InvoiceDisplayStatus {
  if (inv.status === "cancelled") return "DIBATALKAN"
  return deriveInvoiceStatus(inv)
}

// Stored status to its label.
export const BACKEND_LABEL: Record<InvoiceBackendStatus, string> = {
  draft: "Draf",
  sent: "Dikirim",
  overdue: "Terlambat",
  paid: "Dibayar",
  cancelled: "Dibatalkan",
}

export type InvoiceActionKind = "send" | "pay" | "cancel"

export type InvoiceAction = {
  kind: InvoiceActionKind
  label: string
  requiresNote: boolean
}

// Button copy per offered target.
//
// Terlambat is derived from the due date, so an "overdue" entry is never
// turned into a button. A cancel is only ever offered together with the
// Pengganti that replaces it.
const ACTION_BY_TARGET: Partial<
  Record<InvoiceBackendStatus, { kind: InvoiceActionKind; label: string }>
> = {
  sent: { kind: "send", label: "Tandai Dikirim" },
  paid: { kind: "pay", label: "Tandai Dibayar" },
  cancelled: { kind: "cancel", label: "Batalkan & Terbitkan Pengganti" },
}

const ACTION_ORDER: InvoiceActionKind[] = ["send", "pay", "cancel"]

// Server transitions to buttons.
export function invoiceActions(transitions: InvoiceTransition[] | undefined): InvoiceAction[] {
  const out: InvoiceAction[] = []
  for (const t of transitions ?? []) {
    const action = ACTION_BY_TARGET[t.to]
    if (!action || out.some((a) => a.kind === action.kind)) continue
    out.push({ ...action, requiresNote: t.requiresNote })
  }
  return out.sort((a, b) => ACTION_ORDER.indexOf(a.kind) - ACTION_ORDER.indexOf(b.kind))
}

// Filed invoices keep their dates.
export function datesLocked(status: InvoiceBackendStatus): boolean {
  return status === "paid" || status === "cancelled"
}

// API date to input value.
//
// Invoice and due dates are DATE columns, so the calendar day is the first
// ten characters whatever offset the server attached.
export function toInputDate(iso: string | undefined): string {
  if (!iso) return ""
  const day = iso.slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : ""
}

// Input value to RFC 3339.
//
// The API decodes a full timestamp; midnight WIB keeps the same calendar day
// on the Asia/Jakarta pinned session.
export function toApiDate(day: string): string {
  return `${day}T00:00:00+07:00`
}

// Client-side date checks.
export function datesProblem(invoiceDate: string, dueDate: string): string | null {
  if (!invoiceDate) return "Tanggal invoice wajib diisi."
  if (!dueDate) return "Tanggal jatuh tempo wajib diisi."
  if (dueDate < invoiceDate) return "Tanggal jatuh tempo tidak boleh sebelum tanggal invoice."
  return null
}

// Changed fields only.
export function datesPatch(
  inv: Pick<InvoiceBackendRow, "invoiceDate" | "dueDate">,
  invoiceDate: string,
  dueDate: string,
): { invoiceDate?: string; dueDate?: string } {
  const out: { invoiceDate?: string; dueDate?: string } = {}
  if (invoiceDate !== toInputDate(inv.invoiceDate)) out.invoiceDate = toApiDate(invoiceDate)
  if (dueDate !== toInputDate(inv.dueDate)) out.dueDate = toApiDate(dueDate)
  return out
}

// Upload key to display name.
//
// "invoices/12/1700000000-receipt.pdf" becomes "receipt.pdf", and a proof
// under "invoices/12/payment/" reads the same way.
export function fileNameFromKey(objectKey: string | undefined): string {
  if (!objectKey) return ""
  const last = objectKey.split("/").pop() ?? ""
  const dash = last.indexOf("-")
  return dash >= 0 ? last.slice(dash + 1) : last
}

// Client card from the payload.
export function clientInfoOf(inv: InvoiceDetail): ClientInfo {
  return {
    narahubung: inv.contactName,
    phone: inv.contactPhone,
    email: inv.contactEmail ?? inv.companyEmail,
    nomorTKU: inv.companyTkuId,
    npwp: inv.companyNpwp,
    lokasi: inv.companyAddress,
  }
}

export type HistoryItem = {
  id: number
  changedAt: string
  action: string
  note?: string
  hasProof: boolean
}

// Timeline rows, oldest first.
//
// The server stores transitions only, so creation is synthesised from
// createdAt and always comes first.
export function historyItems(
  inv: Pick<InvoiceDetail, "createdAt" | "history" | "replacesInvoiceNo">,
): HistoryItem[] {
  const created: HistoryItem = {
    id: 0,
    changedAt: inv.createdAt,
    action: inv.replacesInvoiceNo
      ? `Dibuat sebagai Draf, pengganti ${inv.replacesInvoiceNo}`
      : "Dibuat sebagai Draf",
    hasProof: false,
  }
  const moves = (inv.history ?? []).map((e) => ({
    id: e.id,
    changedAt: e.changedAt,
    action: `${BACKEND_LABEL[e.fromStatus] ?? e.fromStatus} → ${BACKEND_LABEL[e.toStatus] ?? e.toStatus}`,
    note: e.note || undefined,
    hasProof: e.toStatus === "paid" && Boolean(e.paymentProofKey),
  }))
  return [created, ...moves]
}

// Reason given for the cancel.
export function cancelReason(inv: Pick<InvoiceDetail, "history">): string | undefined {
  const events = inv.history ?? []
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].toStatus === "cancelled") return events[i].note || undefined
  }
  return undefined
}
