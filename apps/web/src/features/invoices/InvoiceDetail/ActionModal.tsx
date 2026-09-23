import { useId, useRef, useState } from "react"
import Modal from "@/components/shared/Modal"
import { ui } from "@/lib/ui"

export type ActionModalKind = "send" | "pay" | "cancel" | "replace"

type ActionModalProps = {
  kind: ActionModalKind
  invoiceNo: string
  pending: boolean
  onClose: () => void
  // Resolves on success only.
  onConfirm: (input: { note: string; proof?: File }) => Promise<void>
}

const PROOF_ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp,.xlsx,.xls"

const COPY: Record<ActionModalKind, { title: string; submit: string }> = {
  send: { title: "Tandai Invoice Dikirim", submit: "Tandai Dikirim" },
  pay: { title: "Tandai Invoice Dibayar", submit: "Tandai Dibayar" },
  cancel: { title: "Batalkan & Terbitkan Pengganti", submit: "Batalkan & Terbitkan" },
  replace: { title: "Terbitkan Invoice Pengganti", submit: "Terbitkan Pengganti" },
}

// Confirmation for one status step.
//
// Stays open while the request runs and closes only after it succeeds; a
// failure is toasted by the mutation and leaves the input in place.
export default function ActionModal({
  kind,
  invoiceNo,
  pending,
  onClose,
  onConfirm,
}: ActionModalProps) {
  const noteId = useId()
  const proofId = useId()
  const [note, setNote] = useState("")
  const [proof, setProof] = useState<File | undefined>()
  const [touched, setTouched] = useState(false)
  const noteRef = useRef<HTMLTextAreaElement>(null)

  const noteMissing = kind === "cancel" && note.trim() === ""
  const copy = COPY[kind]

  async function submit() {
    setTouched(true)
    if (noteMissing) {
      noteRef.current?.focus()
      return
    }
    if (pending) return
    try {
      await onConfirm({ note: note.trim(), proof })
      onClose()
    } catch {
      // Toasted by the mutation.
    }
  }

  return (
    <Modal
      title={copy.title}
      onClose={pending ? () => {} : onClose}
      className="w-[560px]"
      footer={
        <div className="flex w-full justify-end gap-4 max-sm:flex-col-reverse">
          <button type="button" className={ui.modalCancel} onClick={onClose} disabled={pending}>
            Batal
          </button>
          <button
            type="button"
            className={ui.modalSubmit}
            onClick={() => void submit()}
            disabled={pending}
            aria-busy={pending}
          >
            {pending ? "Menyimpan…" : copy.submit}
          </button>
        </div>
      }
    >
      <div className={`${ui.modalSection} text-sm leading-6 text-[#4A4455]`}>
        {kind === "send" && (
          <p>
            Invoice <strong className="text-dark-900">{invoiceNo}</strong> akan ditandai sudah
            dikirim ke klien.
          </p>
        )}
        {kind === "pay" && (
          <>
            <p>
              Invoice <strong className="text-dark-900">{invoiceNo}</strong> akan ditandai lunas.
              Tanggal pembayaran dicatat otomatis saat disimpan. Setelah itu status dan tanggal
              invoice tidak dapat diubah lagi.
            </p>
            <div className={ui.field}>
              <label htmlFor={proofId} className={ui.fieldLabel}>
                Bukti Pembayaran (opsional)
              </label>
              <input
                id={proofId}
                type="file"
                accept={PROOF_ACCEPT}
                disabled={pending}
                onChange={(e) => setProof(e.target.files?.[0])}
                className={`block w-full min-w-0 text-sm text-dark-900 file:mr-3 file:rounded-md file:border-0 file:bg-primary-50 file:px-4 file:py-2 file:text-sm file:font-bold file:text-primary-700 ${ui.focusRing}`}
              />
              <p className="text-caption text-dark-500">PDF, gambar, atau Excel, maksimal 20 MB.</p>
            </div>
          </>
        )}
        {kind === "cancel" && (
          <>
            <p>
              Invoice <strong className="text-dark-900">{invoiceNo}</strong> akan dibatalkan, lalu
              invoice pengganti berstatus Draf diterbitkan untuk PO yang sama. Pembatalan tidak
              dapat dikembalikan.
            </p>
            <div className={ui.field}>
              <label htmlFor={noteId} className={ui.fieldLabel}>
                Alasan Pembatalan
              </label>
              <textarea
                id={noteId}
                ref={noteRef}
                rows={3}
                value={note}
                disabled={pending}
                onChange={(e) => setNote(e.target.value)}
                aria-invalid={touched && noteMissing}
                aria-describedby={touched && noteMissing ? `${noteId}-error` : undefined}
                className={`${ui.fieldInput} resize-y font-sans`}
              />
              {touched && noteMissing && (
                <p id={`${noteId}-error`} className="text-caption text-[#B91C1C]">
                  Alasan pembatalan wajib diisi.
                </p>
              )}
            </div>
          </>
        )}
        {kind === "replace" && (
          <p>
            Invoice pengganti berstatus Draf akan diterbitkan untuk PO yang sama, menggantikan{" "}
            <strong className="text-dark-900">{invoiceNo}</strong>.
          </p>
        )}
      </div>
    </Modal>
  )
}
