import { useId, useMemo, useState } from "react"
import Modal from "@/components/shared/Modal"
import type { FormErrors } from "@/lib/form-errors"
import { ui } from "@/lib/ui"
import type { PurchaseOrderItemRow } from "@/types/api"
import { useSaveDeliveryNote } from "../hooks"
import {
  deliveryNoteChanges,
  deliveryNoteErrors,
  deliveryNoteRows,
  noteField,
} from "./deliveryNote"

type DeliveryNoteModalProps = {
  poId: number
  // If-Match for the save
  rowVersion: number
  items: PurchaseOrderItemRow[]
  // Throws when the download fails
  onDownload: () => Promise<void>
  onClose: () => void
}

// Notes, then the Surat Jalan.
//
// Each product row shows its note as the PDF prints it. A changed note is
// saved before the download; with no change the note just downloads.
export default function DeliveryNoteModal({
  poId,
  rowVersion,
  items,
  onDownload,
  onClose,
}: DeliveryNoteModalProps) {
  const id = useId()
  const rows = useMemo(() => deliveryNoteRows(items), [items])
  const [notes, setNotes] = useState(() => rows.map((r) => r.note))
  const [errors, setErrors] = useState<FormErrors<string> | null>(null)
  const [downloading, setDownloading] = useState(false)
  const save = useSaveDeliveryNote()
  const changes = deliveryNoteChanges(rows, notes)
  const busy = save.isPending || downloading

  async function submit() {
    setErrors(null)
    if (changes) {
      try {
        await save.mutateAsync({ id: poId, notes: changes, rowVersion })
      } catch (err) {
        setErrors(deliveryNoteErrors(err, rows.length))
        return
      }
    }
    setDownloading(true)
    try {
      await onDownload()
      onClose()
    } catch {
      setErrors({ fields: {}, banner: "Surat Jalan gagal diunduh. Coba lagi." })
    } finally {
      setDownloading(false)
    }
  }

  return (
    <Modal
      title="Unduh Surat Jalan"
      onClose={onClose}
      footer={
        <>
          <button type="button" className={ui.modalCancel} onClick={onClose}>
            Batal
          </button>
          <button
            type="button"
            className={ui.modalSubmit}
            disabled={busy}
            onClick={() => void submit()}
          >
            {busy ? "Memproses..." : changes ? "Simpan dan Unduh" : "Unduh"}
          </button>
        </>
      }
    >
      <div className={ui.modalSection}>
        <p className="m-0 text-[13px] leading-[1.5] text-[#4A4455]">
          Catatan dicetak di kolom Notes setiap baris. Kosongkan bila tidak perlu.
        </p>
        {errors?.banner && (
          <p role="alert" className="m-0 text-sm text-[#B91C1C]">
            {errors.banner}
          </p>
        )}
        <ul className="m-0 flex list-none flex-col gap-4 p-0">
          {rows.map((r, i) => {
            const fieldError = errors?.fields[noteField(i)]
            const inputId = `${id}-${r.lineId}`
            return (
              <li key={r.lineId} className={ui.field}>
                <label htmlFor={inputId} className={ui.fieldLabel}>
                  {i + 1}. {r.name}{" "}
                  <span className="font-normal text-[#6B7280]">
                    {r.qty} {r.unit}
                  </span>
                </label>
                <input
                  id={inputId}
                  type="text"
                  maxLength={500}
                  value={notes[i] ?? ""}
                  aria-invalid={fieldError ? true : undefined}
                  aria-describedby={fieldError ? `${inputId}-error` : undefined}
                  onChange={(e) => {
                    const next = [...notes]
                    next[i] = e.target.value
                    setNotes(next)
                  }}
                  className={ui.fieldInput}
                />
                {fieldError && (
                  <p
                    id={`${inputId}-error`}
                    role="alert"
                    className="m-0 mt-1 text-xs text-[#B91C1C]"
                  >
                    {fieldError}
                  </p>
                )}
              </li>
            )
          })}
        </ul>
      </div>
    </Modal>
  )
}
