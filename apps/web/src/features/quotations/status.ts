import { ApiError } from "@/lib/api-client"
import { errorMessage } from "@/lib/errors"
import { QUOTATION_STATUSES, type QuotationStatusLabel, quotationStatusLabel } from "@/lib/status"
import type { QuotationStatus, QuotationStatusCount, QuotationTransition } from "@/types/api"

// Re-exported from lib/status.ts.
//
// Labels and badges live there, shared with the dashboard.
export {
  QUOTATION_STATUS_LABELS,
  QUOTATION_STATUSES,
  type QuotationStatusLabel,
  quotationBadge,
  quotationStatusFromLabel,
  quotationStatusLabel,
} from "@/lib/status"

// Status menu and cancel action.
//
// Cancel is destructive, so it gets its own button instead of sitting in
// the status menu next to the routine moves.
export function splitTransitions(transitions: QuotationTransition[]): {
  moves: QuotationTransition[]
  cancel: QuotationTransition | undefined
} {
  return {
    moves: transitions.filter((t) => t.to !== "cancelled"),
    cancel: transitions.find((t) => t.to === "cancelled"),
  }
}

// Only drafts can be edited.
export function isEditable(status: QuotationStatus): boolean {
  return status === "draft"
}

// Server message for one field.
//
// Reads fields[key] from a 422 problem body, so a form can show it next to
// the input the server rejected.
export function fieldError(err: unknown, key: string): string | undefined {
  if (!(err instanceof ApiError) || err.status !== 422) return undefined
  const value = err.body?.fields?.[key]
  return value?.trim() ? value : undefined
}

// Status change failure toast.
//
// A rejected note already shows under the modal's textarea, so it gets no
// toast; undefined means stay quiet.
export function statusChangeToast(err: unknown): string | undefined {
  if (fieldError(err, "note")) return undefined
  return errorMessage(err, "Gagal mengubah status quotation.")
}

// Status bar helper text.
//
// Says why a move the user expects is missing, instead of an empty menu.
export function statusHint(status: QuotationStatus): string {
  switch (status) {
    case "draft":
      return "Kirim quotation ke klien sebelum dapat disetujui atau ditolak."
    case "sent":
      return "Catat jawaban klien, atau buat revisi bila klien meminta perubahan."
    case "revision":
      return "Quotation ini sudah direvisi. Lanjutkan di draf versi terbaru."
    case "accepted":
      return "Quotation disetujui dan PO sudah dibuat. Status tidak dapat diubah lagi."
    case "expired":
      return "Masa berlaku quotation sudah habis. Status tidak dapat diubah lagi."
    case "rejected":
    case "cancelled":
      return "Status akhir. Status tidak dapat diubah lagi."
  }
}

// Confirm dialog copy per move.
export function transitionCopy(
  t: QuotationTransition,
  current: QuotationStatusLabel,
): { title: string; body: string; submit: string } {
  if (t.to === "cancelled") {
    return {
      title: "Batalkan Quotation",
      body: "Quotation yang dibatalkan tidak dapat diubah atau dikirim lagi.",
      submit: "Batalkan Quotation",
    }
  }
  if (t.to === "accepted") {
    return {
      title: `Ubah Status ke ${t.label}`,
      body: "Menyetujui quotation akan langsung membuat PO. Langkah ini tidak dapat dibatalkan dari halaman quotation.",
      submit: "Setujui",
    }
  }
  return {
    title: `Ubah Status ke ${t.label}`,
    body: `Status quotation akan diubah dari ${current} menjadi ${t.label}.`,
    submit: "Simpan Status",
  }
}

// Tile, count unknown before data.
export type StatTile = Omit<QuotationStatusCount, "count"> & { count: number | undefined }

// Stats rows to tiles.
//
// Before the first response, or after a failed one, the canonical statuses
// show without a count, so the grid does not jump when the data lands and
// zero is never shown as data.
export function statTiles(rows: QuotationStatusCount[] | undefined): {
  total: number | undefined
  tiles: StatTile[]
} {
  if (rows && rows.length > 0) {
    return { total: rows.reduce((s, r) => s + r.count, 0), tiles: rows }
  }
  const tiles = QUOTATION_STATUSES.map((status) => ({
    status,
    label: quotationStatusLabel(status),
    count: undefined,
  }))
  return { total: undefined, tiles }
}
