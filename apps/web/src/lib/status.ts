import type { CanonicalStatus } from "@/types/api";

export type StatusLabel = "Disetujui" | "Dikirim" | "Draf" | "Revisi" | "Ditolak" | "Kadaluarsa";

const labelByCanonical: Record<CanonicalStatus, StatusLabel> = {
  accepted: "Disetujui",
  sent: "Dikirim",
  draft: "Draf",
  revision: "Revisi",
  rejected: "Ditolak",
  expired: "Kadaluarsa",
};

const canonicalByLabel: Record<StatusLabel, CanonicalStatus> = {
  Disetujui: "accepted",
  Dikirim: "sent",
  Draf: "draft",
  Revisi: "revision",
  Ditolak: "rejected",
  Kadaluarsa: "expired",
};

// BE status to label.
export function statusToLabel(s: CanonicalStatus): StatusLabel {
  return labelByCanonical[s];
}

// Label to BE status.
export function labelToStatus(label: StatusLabel): CanonicalStatus {
  return canonicalByLabel[label];
}
