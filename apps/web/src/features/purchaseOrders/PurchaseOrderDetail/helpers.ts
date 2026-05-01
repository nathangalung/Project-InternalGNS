import type { PoStatus } from "../types"

// PO status -> Indonesian label.
export const PO_LABEL: Record<PoStatus, string> = {
  PENDING:     "Pending",
  UPLOADED:    "PO Diunggah",
  ON_PROGRESS: "Sedang Progres",
  DELIVERED:   "Dikirim",
}

// PO status visual tokens.
export const PO_STATUS_CONFIG: Record<PoStatus, { bg: string; color: string }> = {
  PENDING:     { bg: "#FFE16D", color: "#DA6900" },
  UPLOADED:    { bg: "#DBEAFE", color: "#1D4ED8" },
  ON_PROGRESS: { bg: "#CEC2FF", color: "#9333EA" },
  DELIVERED:   { bg: "#D1FAE5", color: "#047857" },
}

export const PO_STATUS_ORDER: PoStatus[] = ["PENDING", "UPLOADED", "ON_PROGRESS", "DELIVERED"]

export function poNumberFromQuotationNo(no: string): string {
  if (no.startsWith("Q-")) return "PO-" + no.slice(2)
  if (no.startsWith("Q")) return "PO" + no.slice(1)
  return "PO-" + no
}

export function shortDocNo(no: string): string {
  const slash = no.indexOf("/")
  if (slash === -1) return no
  return no.slice(0, slash) + "…"
}
