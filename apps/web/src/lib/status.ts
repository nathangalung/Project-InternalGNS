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
