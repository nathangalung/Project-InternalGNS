import type { CanonicalStatus } from "@/types/api"

export type StatusLabel = "Disetujui" | "Dikirim" | "Draf" | "Revisi" | "Ditolak" | "Kadaluarsa"

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

// Quotation labels that render.
export type DisplayStatus = Exclude<StatusLabel, "Kadaluarsa">

// Visual tokens per quotation status.
export const quotationStatusConfig: Record<DisplayStatus, { bg: string; color: string }> = {
  Disetujui: { bg: "var(--status-disetujui-bg)", color: "var(--status-disetujui-color)" },
  Dikirim: { bg: "var(--status-dikirim-bg)", color: "var(--status-dikirim-color)" },
  Draf: { bg: "var(--status-draf-bg)", color: "var(--status-draf-color)" },
  Revisi: { bg: "var(--status-revisi-bg)", color: "var(--status-revisi-color)" },
  Ditolak: { bg: "var(--status-ditolak-bg)", color: "var(--status-ditolak-color)" },
}
