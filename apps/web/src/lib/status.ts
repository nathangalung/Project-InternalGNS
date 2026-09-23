import type { CanonicalStatus, InvoiceBackendRow } from "@/types/api"

export type StatusLabel = "Disetujui" | "Dikirim" | "Draf" | "Revisi" | "Ditolak" | "Kadaluarsa"

// Business timezone, matching the pinned DB session.
const JAKARTA_TZ = "Asia/Jakarta"

const labelByCanonical: Record<CanonicalStatus, StatusLabel> = {
  accepted: "Disetujui",
  sent: "Dikirim",
  draft: "Draf",
  revision: "Revisi",
  rejected: "Ditolak",
  expired: "Kadaluarsa",
}

const canonicalByLabel: Record<StatusLabel, CanonicalStatus> = {
  Disetujui: "accepted",
  Dikirim: "sent",
  Draf: "draft",
  Revisi: "revision",
  Ditolak: "rejected",
  Kadaluarsa: "expired",
}

// Allowed manual transitions; terminal states map to empty.
export const QUOTATION_TRANSITIONS: Record<StatusLabel, StatusLabel[]> = {
  Draf: ["Dikirim"],
  Dikirim: ["Disetujui", "Ditolak", "Revisi"],
  Revisi: ["Dikirim", "Ditolak"],
  Disetujui: [],
  Ditolak: [],
  Kadaluarsa: [],
}

// BE status to label.
export function statusToLabel(s: CanonicalStatus): StatusLabel {
  return labelByCanonical[s]
}

// Label to BE status.
export function labelToStatus(label: StatusLabel): CanonicalStatus {
  return canonicalByLabel[label]
}

export const BADGE_AKTIF = { label: "AKTIF", bg: "#D1FAE5", color: "#047857" }
export const BADGE_NONAKTIF = { label: "NONAKTIF", bg: "#FEE2E2", color: "#B91C1C" }

// All quotation labels render, including expired.
export type DisplayStatus = StatusLabel

// Visual tokens per quotation status.
//
// Badge text is 11px bold, so every text colour clears 4.5:1 on its fill.
// Draf, Revisi and Kadaluarsa were darkened from #DA6900 (2.71), #9333EA (3.28)
// and #64748B (4.34) to 5.48, 5.31 and 6.92.
export const quotationStatusConfig: Record<DisplayStatus, { bg: string; color: string }> = {
  Disetujui: { bg: "var(--status-disetujui-bg)", color: "var(--status-disetujui-color)" },
  Dikirim: { bg: "var(--status-dikirim-bg)", color: "var(--status-dikirim-color)" },
  Draf: { bg: "var(--status-draf-bg)", color: "#92400E" },
  Revisi: { bg: "var(--status-revisi-bg)", color: "#6B21A8" },
  Ditolak: { bg: "var(--status-ditolak-bg)", color: "var(--status-ditolak-color)" },
  Kadaluarsa: { bg: "#F1F5F9", color: "#475569" },
}

// Displayed invoice statuses.
export type InvoiceStatus = "DRAF" | "DIKIRIM" | "DIBAYAR" | "TERLAMBAT"

// Backend status, overdue from due.
export function deriveInvoiceStatus(
  inv: InvoiceBackendRow | null | undefined,
  opts: { cancelledAsNull: true },
): InvoiceStatus | null
export function deriveInvoiceStatus(
  inv: InvoiceBackendRow | null | undefined,
  opts?: { cancelledAsNull?: false },
): InvoiceStatus
export function deriveInvoiceStatus(
  inv: InvoiceBackendRow | null | undefined,
  opts?: { cancelledAsNull?: boolean },
): InvoiceStatus | null {
  if (!inv) return "DRAF"
  if (opts?.cancelledAsNull && inv.status === "cancelled") return null
  if (inv.status === "paid") return "DIBAYAR"
  if (inv.status === "overdue") return "TERLAMBAT"
  const base: InvoiceStatus = inv.status === "sent" ? "DIKIRIM" : "DRAF"
  if (inv.dueDate && isPastDueInJakarta(inv.dueDate)) return "TERLAMBAT"
  return base
}

// Today in Jakarta, as YYYY-MM-DD.
function todayInJakarta(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: JAKARTA_TZ }).format(new Date())
}

// Overdue the day after the due date.
//
// The server decides this with due_date < CURRENT_DATE on a session pinned to
// WIB. Comparing Date objects instead would parse the date-only string as UTC
// midnight, which is 07:00 WIB, so from 07:00 until midnight the client would
// call an invoice overdue while the server still reports it as sent. Comparing
// YYYY-MM-DD strings in Jakarta reproduces the server rule exactly.
function isPastDueInJakarta(dueDate: string): boolean {
  const due = dueDate.slice(0, 10)
  if (due.length !== 10) return false
  return due < todayInJakarta()
}
