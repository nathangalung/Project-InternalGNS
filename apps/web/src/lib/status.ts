import type { InvoiceBackendRow, InvoiceBackendStatus, QuotationStatus } from "@/types/api"

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
] as const satisfies readonly QuotationStatus[]

const LABEL = {
  draft: "Draf",
  sent: "Dikirim",
  revision: "Revisi",
  accepted: "Disetujui",
  rejected: "Ditolak",
  cancelled: "Dibatalkan",
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
// Draf and Revisi were darkened from #DA6900 (2.71) and #9333EA (3.28) to
// 5.48 and 5.31. Dibatalkan uses gray-700 on gray-100 (9.2:1).
export const quotationBadge: Record<QuotationStatusLabel, { bg: string; color: string }> = {
  Draf: { bg: "var(--status-draf-bg)", color: "#92400E" },
  Dikirim: { bg: "var(--status-dikirim-bg)", color: "var(--status-dikirim-color)" },
  Revisi: { bg: "var(--status-revisi-bg)", color: "#6B21A8" },
  Disetujui: { bg: "var(--status-disetujui-bg)", color: "var(--status-disetujui-color)" },
  Ditolak: { bg: "var(--status-ditolak-bg)", color: "var(--status-ditolak-color)" },
  Dibatalkan: { bg: "#F3F4F6", color: "#374151" },
}

export const BADGE_AKTIF = { label: "AKTIF", bg: "#D1FAE5", color: "#047857" }
export const BADGE_NONAKTIF = { label: "NONAKTIF", bg: "#FEE2E2", color: "#B91C1C" }

// Displayed invoice statuses.
export type InvoiceStatus = "DRAF" | "DIKIRIM" | "DIBAYAR" | "TERLAMBAT"

const INVOICE_DISPLAY: Record<Exclude<InvoiceBackendStatus, "cancelled">, InvoiceStatus> = {
  draft: "DRAF",
  sent: "DIKIRIM",
  paid: "DIBAYAR",
  overdue: "TERLAMBAT",
}

// Display status from the server.
//
// Terlambat is the API's effectiveStatus (fn_invoice_effective_status on the
// WIB-pinned session); the web never recomputes it from the due date.
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
  if (inv.effectiveStatus === "cancelled") return opts?.cancelledAsNull ? null : "DRAF"
  return INVOICE_DISPLAY[inv.effectiveStatus]
}
