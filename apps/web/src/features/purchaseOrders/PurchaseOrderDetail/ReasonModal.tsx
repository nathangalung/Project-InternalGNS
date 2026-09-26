import { useId, useState } from "react"
import Modal from "@/components/shared/Modal"
import { ui } from "@/lib/ui"

type ReasonModalProps = {
  // e.g. "Dibatalkan"
  statusLabel: string
  submitting: boolean
  onClose: () => void
  onSubmit: (note: string) => void
}

// Required reason before a move.
export default function ReasonModal({
  statusLabel,
  submitting,
  onClose,
  onSubmit,
}: ReasonModalProps) {
  const id = useId()
  const [note, setNote] = useState("")
  const trimmed = note.trim()

  return (
    <Modal
      title={`Ubah status menjadi ${statusLabel}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={ui.modalCancel} onClick={onClose}>
            Batal
          </button>
          <button
            type="button"
            className={ui.modalSubmit}
            disabled={trimmed === "" || submitting}
            onClick={() => onSubmit(trimmed)}
          >
            {submitting ? "Menyimpan..." : "Simpan"}
          </button>
        </>
      }
    >
      <div className={ui.modalSection}>
        <p className="m-0 text-[13px] leading-[1.5] text-[#4A4455]">
          Status {statusLabel} bersifat final. Alasannya tersimpan di riwayat status PO.
        </p>
        <div className={ui.field}>
          <label htmlFor={id} className={ui.fieldLabel}>
            Alasan <span className="text-[#DC2626]">*</span>
          </label>
          <textarea
            id={id}
            rows={4}
            required
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className={`${ui.fieldInput} resize-y font-sans`}
          />
        </div>
      </div>
    </Modal>
  )
}
