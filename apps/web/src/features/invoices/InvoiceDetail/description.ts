import { errorMessage, isVersionConflict } from "@/lib/errors"
import { type FormErrors, formErrors } from "@/lib/form-errors"
import { formatNumber } from "@/lib/format"
import type { InvoiceBackendStatus, InvoiceItemRow, InvoiceLineDescriptionInput } from "@/types/api"
import { datesLocked } from "./helpers"

// One row of the Unduh Invoice dialog.
export type DescriptionRow = {
  lineId: number
  // As the PDF prints it, IMPA code first
  name: string
  qty: string
  unit: string
  // What the Description cell prints today
  description: string
}

export const DESCRIPTION_CONFLICT_MESSAGE =
  "Invoice ini baru saja diubah di tempat lain. Periksa deskripsinya lalu simpan lagi."

const SAVE_FAILED = "Gagal menyimpan deskripsi invoice."

// Every printed line and its text.
//
// A saved description wins, an empty one included. Until one is saved the
// row starts with the line's destination, which the PDF prints by default.
export function descriptionRows(items: InvoiceItemRow[] | undefined): DescriptionRow[] {
  return (items ?? []).map((it) => ({
    lineId: it.id,
    name: it.itemCode ? `${it.itemCode} - ${it.itemName}` : it.itemName,
    qty: formatNumber(it.qty),
    unit: it.unitCode ?? "",
    description: it.description ?? it.shipDestination ?? "",
  }))
}

// Descriptions to save, if any changed.
//
// Once one row changed, every row is sent, so a reprint prints exactly what
// the dialog showed. A cleared row goes as empty and prints nothing.
export function descriptionChanges(
  rows: DescriptionRow[],
  typed: string[],
): InvoiceLineDescriptionInput[] | null {
  const next = rows.map((_, i) => (typed[i] ?? "").trim())
  if (rows.every((r, i) => r.description.trim() === next[i])) return null
  return rows.map((r, i) => ({ lineId: r.lineId, description: next[i] }))
}

// Paid and cancelled invoices print as filed, like their dates.
export function descriptionsEditable(status: InvoiceBackendStatus): boolean {
  return !datesLocked(status)
}

// Field key of a row's description.
export const descriptionField = (i: number) => `lines[${i}].description`

// A refused save, for the dialog.
//
// A text too long sits on its row. A stale version says the invoice changed,
// and a filed invoice keeps the server's own reason.
export function descriptionErrors(err: unknown, count: number): FormErrors<string> {
  const keys = Array.from({ length: count }, (_, i) => descriptionField(i))
  const split = formErrors(err, keys, SAVE_FAILED)
  if (Object.keys(split.fields).length > 0) return split
  const banner = isVersionConflict(err)
    ? DESCRIPTION_CONFLICT_MESSAGE
    : errorMessage(err, SAVE_FAILED)
  return { fields: {}, banner }
}
