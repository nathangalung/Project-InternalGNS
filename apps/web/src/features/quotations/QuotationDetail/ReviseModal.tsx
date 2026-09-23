import { useNavigate } from "@tanstack/react-router"
import { useId, useState } from "react"
import Modal from "@/components/shared/Modal"
import { useReviseQuotation } from "@/features/quotations/hooks"
import { toast } from "@/lib/toast"
import { ui } from "@/lib/ui"

type ReviseModalProps = {
  quotationId: number
  version: number
  onClose: () => void
}

// Buat Revisi confirmation.
//
// The server clones the quotation as a new draft and freezes the original,
// so on success the user lands in the new draft's editor.
export default function ReviseModal({ quotationId, version, onClose }: ReviseModalProps) {
  const navigate = useNavigate()
  const noteId = useId()
  const [note, setNote] = useState("")
  const revise = useReviseQuotation()

  function submit() {
    if (revise.isPending) return
    revise.mutate(
      { id: quotationId, note: note.trim() || undefined },
      {
        onSuccess: ({ id }) => {
          toast.success(`Draf revisi versi ${version + 1} dibuat.`)
          onClose()
          void navigate({ to: "/quotations/$id/edit", params: { id: String(id) } })
        },
      },
    )
  }

  return (
    <Modal
      title="Buat Revisi"
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
            disabled={revise.isPending}
          >
            {revise.isPending ? "Membuat…" : "Buat Revisi"}
          </button>
        </>
      }
    >
      <div className={ui.modalSection}>
        <p className="text-sm leading-6 text-[#4A4455]">
          Quotation ini akan berstatus Revisi dan tidak dapat diubah lagi. Draf baru versi{" "}
          {version + 1} dibuat dengan isi yang sama, lalu dibuka untuk Anda ubah.
        </p>
        <div className={ui.field}>
          <label htmlFor={noteId} className={ui.fieldLabel}>
            Catatan revisi (opsional)
          </label>
          <textarea
            id={noteId}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Contoh: klien meminta perubahan harga"
            className={`${ui.fieldInput} min-h-[96px] resize-y font-sans`}
          />
        </div>
      </div>
    </Modal>
  )
}
