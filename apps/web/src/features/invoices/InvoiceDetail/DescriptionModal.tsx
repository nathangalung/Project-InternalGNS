import { useId, useMemo, useState } from "react"
import Modal from "@/components/shared/Modal"
import type { FormErrors } from "@/lib/form-errors"
import { ui } from "@/lib/ui"
import type { InvoiceItemRow } from "@/types/api"
import { useSaveInvoiceDescriptions } from "../hooks"
import {
  descriptionChanges,
  descriptionErrors,
  descriptionField,
  descriptionRows,
} from "./description"

type DescriptionModalProps = {
  invoiceId: number
  // If-Match for the save
  rowVersion: number
  items: InvoiceItemRow[]
  // Throws when the download fails
  onDownload: () => Promise<void>
  onClose: () => void
}

// Descriptions, then the invoice PDF.
//
// Each line shows its Description as the PDF prints it. A changed one is
// saved before the download; with no change the invoice just downloads.
export default function DescriptionModal({
  invoiceId,
  rowVersion,
  items,
  onDownload,
  onClose,
}: DescriptionModalProps) {
  const id = useId()
  const rows = useMemo(() => descriptionRows(items), [items])
  const [texts, setTexts] = useState(() => rows.map((r) => r.description))
  const [errors, setErrors] = useState<FormErrors<string> | null>(null)
  const [downloading, setDownloading] = useState(false)
  const save = useSaveInvoiceDescriptions()
  const changes = descriptionChanges(rows, texts)
  const busy = save.isPending || downloading

  async function submit() {
    setErrors(null)
    if (changes) {
      try {
        await save.mutateAsync({ id: invoiceId, lines: changes, rowVersion })
      } catch (err) {
        setErrors(descriptionErrors(err, rows.length))
        return
      }
    }
    setDownloading(true)
    try {
      await onDownload()
      onClose()
    } catch {
      setErrors({ fields: {}, banner: "PDF invoice gagal diunduh. Coba lagi." })
    } finally {
      setDownloading(false)
    }
  }

  return (
    <Modal
      title="Unduh Invoice"
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
          Deskripsi dicetak di kolom Description setiap baris. Kosongkan bila tidak perlu.
        </p>
        {errors?.banner && (
          <p role="alert" className="m-0 text-sm text-[#B91C1C]">
            {errors.banner}
          </p>
        )}
        <ul className="m-0 flex list-none flex-col gap-4 p-0">
          {rows.map((r, i) => {
            const fieldError = errors?.fields[descriptionField(i)]
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
                  value={texts[i] ?? ""}
                  aria-invalid={fieldError ? true : undefined}
                  aria-describedby={fieldError ? `${inputId}-error` : undefined}
                  onChange={(e) => {
                    const next = [...texts]
                    next[i] = e.target.value
                    setTexts(next)
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
