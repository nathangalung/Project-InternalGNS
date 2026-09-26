import Modal from "@/components/shared/Modal"
import { ui } from "@/lib/ui"
import { formatRp } from "./helpers"

type PriceConfirmModalProps = {
  open: boolean
  onCancel: () => void
  onConfirm: () => void
  isBeliChanged: boolean
  isJualChanged: boolean
  initialBeli: number | null
  initialJual: number | null
  currentBeli: number
  currentJual: number
}

// Confirm price changes modal.
export default function PriceConfirmModal({
  open,
  onCancel,
  onConfirm,
  isBeliChanged,
  isJualChanged,
  initialBeli,
  initialJual,
  currentBeli,
  currentJual,
}: PriceConfirmModalProps) {
  if (!open) return null
  return (
    <Modal
      title="Konfirmasi Perubahan Harga"
      onClose={onCancel}
      className="max-w-[min(440px,92vw)]!"
      footer={
        <div className="flex gap-4 max-sm:w-full max-sm:*:flex-1 max-sm:*:px-4">
          <button type="button" className={ui.modalCancel} onClick={onCancel}>
            Batal
          </button>
          <button type="button" className={ui.modalSubmit} onClick={onConfirm}>
            Ya, Ubah
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-3 text-sm text-[#374151]">
        <p className="leading-[1.5] text-[#4B5563]">Apakah Anda yakin mengubah:</p>
        <ul className="list-disc pl-5">
          {isBeliChanged && initialBeli !== null && (
            <li className="mb-2">
              Harga beli dari{" "}
              <strong className="whitespace-nowrap">Rp{formatRp(initialBeli)}</strong> menjadi{" "}
              <strong className="whitespace-nowrap">Rp{formatRp(currentBeli)}</strong>
            </li>
          )}
          {isJualChanged && initialJual !== null && (
            <li>
              Harga jual dari{" "}
              <strong className="whitespace-nowrap">Rp{formatRp(initialJual)}</strong> menjadi{" "}
              <strong className="whitespace-nowrap">Rp{formatRp(currentJual)}</strong>
            </li>
          )}
        </ul>
      </div>
    </Modal>
  )
}
