import { ApiError } from "@/lib/api-client"
import { errorMessage } from "@/lib/errors"
import { toNum } from "@/lib/format"
import type { InvoiceBackendStatus, PurchaseOrderRow } from "@/types/api"
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

// Delivered or cancelled freezes lines.
export function isPoLocked(status: PoStatus): boolean {
  return status === "DELIVERED" || status === "CANCELLED"
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
  const fileLocked = isPoLocked(status)
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
  if (!(err instanceof ApiError) || err.status !== 409) return false
  const body = err.body
  return (
    typeof body === "object" &&
    body !== null &&
    (body as { code?: unknown }).code === PO_LOCKED_CODE
  )
}

// Stale row_version, not a lock.
//
// The optimistic-lock 409 carries an English detail, so it gets Indonesian
// copy. The lock 409 carries its own Indonesian detail.
export function isVersionConflict(err: unknown): boolean {
  return (
    err instanceof ApiError &&
    err.status === 409 &&
    !isPoLockRefusal(err) &&
    /row_version/i.test(err.message)
  )
}

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

// One gap the server reported.
export type CompletenessIssue = {
  kind: "client" | "vendor"
  id: number
  // Parsed from the sentence when possible
  name?: string
  missing: string[]
  // Server sentence, shown when parsing fails
  message: string
}

const ISSUE_KEY = /^(klien|vendor):(\d+)$/
const ISSUE_TEXT = /^Data (?:klien|vendor) (.+) belum lengkap: (.+)$/

// Completeness 422 into issues.
//
// The ON_PROGRESS gate answers 422 with fields keyed klien:<id> or
// vendor:<id>. Returns null for any other body, so the caller falls back to
// the plain error toast.
export function parseCompletenessIssues(body: unknown): CompletenessIssue[] | null {
  if (!body || typeof body !== "object") return null
  const fields = (body as { fields?: unknown }).fields
  if (!fields || typeof fields !== "object") return null
  const issues: CompletenessIssue[] = []
  for (const [key, value] of Object.entries(fields)) {
    const k = ISSUE_KEY.exec(key)
    if (!k) continue
    const message = String(value).trim()
    const t = ISSUE_TEXT.exec(message)
    issues.push({
      kind: k[1] === "klien" ? "client" : "vendor",
      id: Number(k[2]),
      name: t?.[1],
      missing: t ? t[2].split(",").map((m) => m.trim()) : [],
      message,
    })
  }
  if (issues.length === 0) return null
  // Client first, then vendors by id.
  return issues.sort((a, b) => (a.kind === b.kind ? a.id - b.id : a.kind === "client" ? -1 : 1))
}
