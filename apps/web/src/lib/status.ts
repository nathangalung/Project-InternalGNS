import type { InvoiceBackendRow, QuotationStatus } from "@/types/api"

// Quotation status labels.
//
// Mirrors quotations.Statuses on the server, in its canonical order. The
// server also sends labels on stats and transitions; this map covers the
// fields that carry only the status key.
export const QUOTATION_STATUSES = [
  "draft",
  "sent",
  "revision",
  "accepted",
  "rejected",
  "cancelled",
  "expired",
] as const satisfies readonly QuotationStatus[]

const LABEL = {
  draft: "Draf",
  sent: "Dikirim",
  revision: "Revisi",
  accepted: "Disetujui",
  rejected: "Ditolak",
  cancelled: "Dibatalkan",
  expired: "Kedaluwarsa",
} as const satisfies Record<QuotationStatus, string>

export type QuotationStatusLabel = (typeof LABEL)[QuotationStatus]

const STATUS_BY_LABEL = Object.fromEntries(QUOTATION_STATUSES.map((s) => [LABEL[s], s])) as Record<
  QuotationStatusLabel,
  QuotationStatus
>

// Every label, canonical order.
export const QUOTATION_STATUS_LABELS: QuotationStatusLabel[] = QUOTATION_STATUSES.map(
  (s) => LABEL[s],
)

export function quotationStatusLabel(s: QuotationStatus): QuotationStatusLabel {
  return LABEL[s]
}

export function quotationStatusFromLabel(label: QuotationStatusLabel): QuotationStatus {
  return STATUS_BY_LABEL[label]
}

// Badge colours per label.
//
// Badge text is 11px bold, so every text colour clears 4.5:1 on its fill.
// Draf, Revisi and Kedaluwarsa were darkened from #DA6900 (2.71), #9333EA
// (3.28) and #64748B (4.34) to 5.48, 5.31 and 6.92. Dibatalkan uses gray-700
// on gray-100 (9.2:1).
export const quotationBadge: Record<QuotationStatusLabel, { bg: string; color: string }> = {
  Draf: { bg: "var(--status-draf-bg)", color: "#92400E" },
  Dikirim: { bg: "var(--status-dikirim-bg)", color: "var(--status-dikirim-color)" },
  Revisi: { bg: "var(--status-revisi-bg)", color: "#6B21A8" },
  Disetujui: { bg: "var(--status-disetujui-bg)", color: "var(--status-disetujui-color)" },
  Ditolak: { bg: "var(--status-ditolak-bg)", color: "var(--status-ditolak-color)" },
  Dibatalkan: { bg: "#F3F4F6", color: "#374151" },
  Kedaluwarsa: { bg: "#F1F5F9", color: "#475569" },
}

export const BADGE_AKTIF = { label: "AKTIF", bg: "#D1FAE5", color: "#047857" }
export const BADGE_NONAKTIF = { label: "NONAKTIF", bg: "#FEE2E2", color: "#B91C1C" }

// Business timezone, matching the pinned DB session.
const JAKARTA_TZ = "Asia/Jakarta"

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
