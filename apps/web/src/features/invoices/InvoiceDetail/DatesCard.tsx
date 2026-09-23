import { useId, useState } from "react"
import { ui } from "@/lib/ui"
import type { InvoiceDetail } from "../types"
import { datesLocked, datesPatch, datesProblem, toInputDate } from "./helpers"

type DatesCardProps = {
  inv: InvoiceDetail
  pending: boolean
  // Resolves on success only.
  onSave: (input: { invoiceDate?: string; dueDate?: string }) => Promise<void>
}

const dateInput = `${ui.fieldInput} h-11 min-w-0 font-sans ${ui.disabledField}`

// Invoice and due date editor.
//
// Paid and cancelled invoices are filed, so their inputs stay visible but
// locked, with the reason under them. The parent remounts this card per
// invoice id and row version, which resets the fields to the saved values.
export default function DatesCard({ inv, pending, onSave }: DatesCardProps) {
  const id = useId()
  const [invoiceDate, setInvoiceDate] = useState(() => toInputDate(inv.invoiceDate))
  const [dueDate, setDueDate] = useState(() => toInputDate(inv.dueDate))
  const locked = datesLocked(inv.status)
  const problem = datesProblem(invoiceDate, dueDate)
  const patch = datesPatch(inv, invoiceDate, dueDate)
  const dirty = Object.keys(patch).length > 0

  async function save() {
    if (locked || problem || !dirty) return
    try {
      await onSave(patch)
    } catch {
      // Toasted by the mutation.
    }
  }

  return (
    <section aria-labelledby={`${id}-title`}>
      <h2
        id={`${id}-title`}
        className="mb-3 text-base font-bold leading-6 tracking-[-0.025em] text-dark-900"
      >
        Tanggal Invoice
      </h2>
      <div className="flex flex-col gap-4 rounded-lg border border-[rgba(204,195,216,0.2)] bg-white px-6 py-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <div className={ui.field}>
            <label htmlFor={`${id}-invoice`} className={ui.fieldLabel}>
              Tanggal Invoice
            </label>
            <input
              id={`${id}-invoice`}
              type="date"
              className={dateInput}
              value={invoiceDate}
              disabled={locked || pending}
              onChange={(e) => setInvoiceDate(e.target.value)}
            />
          </div>
          <div className={ui.field}>
            <label htmlFor={`${id}-due`} className={ui.fieldLabel}>
              Jatuh Tempo
            </label>
            <input
              id={`${id}-due`}
              type="date"
              className={dateInput}
              value={dueDate}
              min={invoiceDate || undefined}
              disabled={locked || pending}
              aria-invalid={!locked && problem !== null}
              aria-describedby={`${id}-hint`}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>
          {!locked && (
            <button
              type="button"
              className={ui.btnPrimary}
              onClick={() => void save()}
              disabled={pending || !dirty || problem !== null}
            >
              {pending ? "Menyimpan…" : "Simpan Tanggal"}
            </button>
          )}
        </div>
        <p
          id={`${id}-hint`}
          className={`text-caption ${!locked && problem ? "text-[#B91C1C]" : "text-dark-500"}`}
        >
          {locked
            ? "Tanggal invoice yang sudah dibayar atau dibatalkan tidak dapat diubah."
            : (problem ?? "Jatuh tempo menentukan kapan invoice dianggap Terlambat.")}
        </p>
      </div>
    </section>
  )
}
