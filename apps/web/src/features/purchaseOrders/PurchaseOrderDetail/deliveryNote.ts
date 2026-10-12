import { type FormErrors, formErrors } from "@/lib/form-errors"
import { formatNumber } from "@/lib/format"
import type { PoDeliveryNoteLineInput, PurchaseOrderItemRow } from "@/types/api"
import { poErrorMessage } from "./helpers"

// One row of the Surat Jalan dialog.
export type DeliveryNoteRow = {
  lineId: number
  name: string
  qty: string
  unit: string
  // What the note prints today
  note: string
}

// Product rows and their notes.
//
// A saved note wins, an empty one included. Until one is saved the row
// starts with the default the server works out.
export function deliveryNoteRows(items: PurchaseOrderItemRow[] | undefined): DeliveryNoteRow[] {
  return (items ?? [])
    .filter((it) => it.itemType === "product")
    .map((it) => ({
      lineId: it.id,
      name: it.itemName,
      qty: formatNumber(it.qty),
      unit: it.unitCode ?? "",
      note: it.dnNote ?? it.dnNoteDefault ?? "",
    }))
}

// Notes to save, if any changed.
//
// Once one row changed, every row is sent, so a reprint prints exactly what
// the dialog showed. A cleared note goes as empty and prints nothing.
export function deliveryNoteChanges(
  rows: DeliveryNoteRow[],
  notes: string[],
): PoDeliveryNoteLineInput[] | null {
  const typed = rows.map((_, i) => (notes[i] ?? "").trim())
  if (rows.every((r, i) => r.note.trim() === typed[i])) return null
  return rows.map((r, i) => ({ lineId: r.lineId, note: typed[i] }))
}

// Field key of a row's note.
export const noteField = (i: number) => `notes[${i}].note`

// A refused save, for the dialog.
//
// A note too long sits on its row. A stale version says the page reloaded,
// and a lock keeps the server's own detail.
export function deliveryNoteErrors(err: unknown, count: number): FormErrors<string> {
  const keys = Array.from({ length: count }, (_, i) => noteField(i))
  const split = formErrors(err, keys, "Gagal menyimpan catatan surat jalan.")
  if (Object.keys(split.fields).length > 0) return split
  return { fields: {}, banner: poErrorMessage(err, "Gagal menyimpan catatan surat jalan.") }
}
