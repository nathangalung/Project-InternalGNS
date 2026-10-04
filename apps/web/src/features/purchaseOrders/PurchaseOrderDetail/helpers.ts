import { ApiError } from "@/lib/api-client"
import { errorMessage, isVersionConflict, problemCode } from "@/lib/errors"
import { toNum } from "@/lib/format"
import type {
  InvoiceBackendStatus,
  PoCompletenessIssue,
  PoIncompleteProblem,
  PurchaseOrderRow,
} from "@/types/api"
import type { PoStatus } from "../types"

// PO status -> Indonesian label.
export const PO_LABEL: Record<PoStatus, string> = {
  PENDING: "Pending",
  UPLOADED: "PO Diunggah",
  ON_PROGRESS: "Dalam Progres",
  DELIVERED: "Dikirim",
  CANCELLED: "Dibatalkan",
}

// Badge colours, text at 4.5:1+.
export const PO_STATUS_CONFIG: Record<PoStatus, { bg: string; color: string }> = {
  PENDING: { bg: "#FFE16D", color: "#92400E" },
  UPLOADED: { bg: "#DBEAFE", color: "#1D4ED8" },
  ON_PROGRESS: { bg: "#CEC2FF", color: "#6B21A8" },
  DELIVERED: { bg: "#D1FAE5", color: "#047857" },
  CANCELLED: { bg: "#FEE2E2", color: "#B91C1C" },
}

// Server display order.
export const PO_STATUS_ORDER: PoStatus[] = [
  "PENDING",
  "UPLOADED",
  "ON_PROGRESS",
  "DELIVERED",
  "CANCELLED",
]

export function shortDocNo(no: string): string {
  const slash = no.indexOf("/")
  if (slash === -1) return no
  return `${no.slice(0, slash)}…`
}

// Delivered or cancelled keeps file.
export function isPoFileLocked(status: PoStatus): boolean {
  return status === "DELIVERED" || status === "CANCELLED"
}

// Why Ubah PO is refused.
//
// The server sets linesLocked: a cancelled PO, or a delivered one unless its
// invoice is cancelled and not yet replaced. Null means the lines are open.
export function poEditLockReason(
  po: Pick<PurchaseOrderRow, "status" | "linesLocked">,
): string | null {
  if (!po.linesLocked) return null
  if (po.status === "CANCELLED") return "PO yang dibatalkan tidak dapat diubah."
  if (po.status === "DELIVERED") {
    return "PO yang sudah dikirim hanya dapat diubah setelah invoicenya dibatalkan dan sebelum invoice pengganti diterbitkan."
  }
  return "PO ini tidak dapat diubah."
}

// What the upload modal allows.
export type UploadRules = {
  // Delivered or cancelled keeps its file
  fileLocked: boolean
  // First upload needs a file
  needsFile: boolean
  // False when nothing is left to change
  editable: boolean
}

// Upload modal rules per PO.
//
// The server refuses a file swap once the PO is delivered or cancelled, and
// number and date once the invoice is filed. A PO that reached work without a
// file can still fix its details, so a locked file is never required.
export function uploadRules(
  status: PoStatus,
  hasFile: boolean,
  detailsLocked: boolean,
): UploadRules {
  const fileLocked = isPoFileLocked(status)
  return {
    fileLocked,
    needsFile: !fileLocked && !hasFile,
    editable: !(fileLocked && detailsLocked),
  }
}

// Surat Jalan needs issued number.
export function canDownloadDeliveryNote(
  po: Pick<PurchaseOrderRow, "status" | "deliveryNoteNumber">,
): boolean {
  const started = po.status === "ON_PROGRESS" || po.status === "DELIVERED"
  return started && Boolean(po.deliveryNoteNumber?.trim())
}

// Download name from stored number.
export function deliveryNoteFileName(deliveryNoteNumber: string): string {
  return `${deliveryNoteNumber.trim().replace(/[^A-Za-z0-9._-]/g, "_")}.pdf`
}

// Filed invoice freezes number, date.
export function isInvoiceFiled(status: InvoiceBackendStatus | undefined): boolean {
  return status === "sent" || status === "paid" || status === "overdue"
}

export const PO_CONFLICT_MESSAGE =
  "Data PO sudah diubah pengguna lain. Halaman dimuat ulang, periksa lalu simpan kembali."

// PO lock refusal code.
export const PO_LOCKED_CODE = "po_locked"

// Server refused a locked PO.
//
// A lock is a state change, not a race: the page reloads the PO and shows the
// server's Indonesian detail, and retrying the same write cannot succeed.
export function isPoLockRefusal(err: unknown): boolean {
  return err instanceof ApiError && err.status === 409 && problemCode(err) === PO_LOCKED_CODE
}

// Stale save gets PO copy.
//
// It says the page reloaded, which the server detail cannot know. A lock
// keeps the server's own Indonesian detail.
export function poErrorMessage(err: unknown, fallback: string): string {
  return isVersionConflict(err) ? PO_CONFLICT_MESSAGE : errorMessage(err, fallback)
}

// Figures the cost breakdown renders.
export type PoBreakdown = {
  totalProduk: number
  discountPct: number
  nominalDiskon: number
  subTotal: number
  dppNilaiLain: number
  ppn12: number
  totalProfit: number
  grandTotal: number
}

// PO totals exactly as stored.
//
// Every figure comes from v_po_totals, which rounds per line the way the
// invoice does, so the page matches the invoice this PO becomes. Sub Total is
// the discounted product value, before shipping.
export function poBreakdown(po: PurchaseOrderRow): PoBreakdown {
  const totalProduk = toNum(po.poTotalProduk)
  const nominalDiskon = toNum(po.poTotalDiscount)
  return {
    totalProduk,
    discountPct: toNum(po.discountPct),
    nominalDiskon,
    subTotal: totalProduk - nominalDiskon,
    dppNilaiLain: toNum(po.poDppNilaiLain),
    ppn12: toNum(po.poPpnAmount),
    totalProfit: toNum(po.poTotalProfit),
    grandTotal: toNum(po.poGrandTotal),
  }
}

// Readiness gate problem code.
export const PO_INCOMPLETE_CODE = "po_incomplete"

// Typed gaps of the gate.
//
// The ON_PROGRESS gate answers 422 with code po_incomplete and the gaps as
// typed issues (client, vendors, then the PO's shipping address). Returns
// null for any other failure, so the caller falls back to the plain toast.
export function completenessIssues(err: unknown): PoCompletenessIssue[] | null {
  if (!(err instanceof ApiError) || err.status !== 422) return null
  const body: Partial<PoIncompleteProblem> | null = err.body
  if (body?.code !== PO_INCOMPLETE_CODE || !Array.isArray(body.issues)) return null
  return body.issues.length > 0 ? body.issues : null
}
