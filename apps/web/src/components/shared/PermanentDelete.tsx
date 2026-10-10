import { useState } from "react"
import Modal from "@/components/shared/Modal"
import { errorMessage } from "@/lib/errors"
import { btnRemove, ui } from "@/lib/ui"

type PermanentDeleteProps = {
  // Record noun, lower case ("klien").
  noun: string
  name: string
  // What goes with the record.
  along: string
  // Deletes, then leaves the page.
  onDelete: () => Promise<unknown>
}

// Hapus Permanen with confirmation.
//
// The confirm dialog names the record and shows any failure inline, the
// server's refusal of a used record included, so the reader can deactivate
// it instead.
export default function PermanentDelete({ noun, name, along, onDelete }: PermanentDeleteProps) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const close = () => {
    if (busy) return
    setOpen(false)
    setError(null)
  }

  const confirm = async () => {
    setBusy(true)
    setError(null)
    try {
      await onDelete()
    } catch (err) {
      setError(errorMessage(err, `Gagal menghapus ${noun}.`))
      setBusy(false)
    }
  }

  return (
    <>
      <button type="button" className={btnRemove} onClick={() => setOpen(true)}>
        Hapus Permanen
      </button>
      {open && (
        <Modal
          title={`Hapus ${noun} permanen?`}
          onClose={close}
          className="max-w-[min(480px,92vw)]!"
          footer={
            <>
              <button type="button" className={ui.modalCancel} onClick={close} disabled={busy}>
                Batal
              </button>
              <button type="button" className={ui.modalSubmit} onClick={confirm} disabled={busy}>
                {busy ? "Menghapus..." : "Hapus Permanen"}
              </button>
            </>
          }
        >
          <div className="flex flex-col gap-3 pb-4 text-sm leading-6 text-[#4A4455]">
            <p className="m-0">
              <strong className="break-words text-[#191C1E]">{name}</strong> dihapus untuk selamanya
              beserta {along}. Penghapusan ini tidak dapat dibatalkan.
            </p>
            <p className="m-0">
              Hanya {noun} yang belum dipakai di dokumen apa pun yang dapat dihapus.
            </p>
            {error && (
              <div
                role="alert"
                className="rounded-md border-l-4 border-[#DC2626] bg-[#FEF2F2] px-4 py-3 text-[13px] text-[#7F1D1D]"
              >
                {error}
              </div>
            )}
          </div>
        </Modal>
      )}
    </>
  )
}
