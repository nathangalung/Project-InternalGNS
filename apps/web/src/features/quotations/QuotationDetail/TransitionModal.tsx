import { useId, useState } from "react"
import Modal from "@/components/shared/Modal"
import { useChangeQuotationStatus } from "@/features/quotations/hooks"
import type { Status } from "@/features/quotations/types"
import { toast } from "@/lib/toast"
import { ui } from "@/lib/ui"
import type { QuotationTransition } from "@/types/api"
import { fieldError, transitionCopy } from "../status"

type TransitionModalProps = {
  quotationId: number
  current: Status
  transition: QuotationTransition
  onClose: () => void
}

// Confirm one status move.
//
// A move that requires a note keeps submit disabled until the reason has
// text; the server's fields.note message lands under the textarea.
export default function TransitionModal({
  quotationId,
  current,
  transition,
  onClose,
}: TransitionModalProps) {
  const noteId = useId()
  const errorId = useId()
  const [note, setNote] = useState("")
  const change = useChangeQuotationStatus()
  const copy = transitionCopy(transition, current)
  const trimmed = note.trim()
  const blocked = transition.requiresNote && trimmed === ""
  const noteErr = fieldError(change.error, "note")

  function submit() {
    if (blocked || change.isPending) return
    change.mutate(
      { id: quotationId, status: transition.to, note: trimmed || undefined },
      {
        onSuccess: () => {
          toast.success(`Status quotation diubah menjadi ${transition.label}.`)
          onClose()
        },
      },
    )
  }

  return (
    <Modal
      title={copy.title}
      onClose={onClose}
      className="max-w-[min(520px,92vw)]!"
      footer={
        <>
          <button type="button" className={ui.modalCancel} onClick={onClose}>
            Batal
          </button>
          <button
            type="button"
            className={ui.modalSubmit}
            onClick={submit}
            disabled={blocked || change.isPending}
          >
            {change.isPending ? "Menyimpan…" : copy.submit}
          </button>
        </>
      }
    >
      <div className={ui.modalSection}>
        <p className="text-sm leading-6 text-[#4A4455]">{copy.body}</p>
        <div className={ui.field}>
          <label htmlFor={noteId} className={ui.fieldLabel}>
            {transition.requiresNote ? (
              <>
                Alasan <span className="text-primary-700">*</span>
              </>
            ) : (
              "Catatan (opsional)"
            )}
          </label>
          <textarea
            id={noteId}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            required={transition.requiresNote}
            aria-invalid={noteErr ? true : undefined}
            aria-describedby={noteErr ? errorId : undefined}
            placeholder={
              transition.requiresNote ? "Tuliskan alasan perubahan status" : "Tambahkan catatan"
            }
            className={`${ui.fieldInput} min-h-[96px] resize-y`}
          />
          {noteErr && (
            <p id={errorId} className="text-xs text-[#DC2626]">
              {noteErr}
            </p>
          )}
        </div>
      </div>
    </Modal>
  )
}
