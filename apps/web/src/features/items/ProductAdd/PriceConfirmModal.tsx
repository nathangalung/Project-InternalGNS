import { confirmModalCls, confirmOverlayCls, formatRp } from "./helpers"

interface PriceConfirmModalProps {
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
    <div className={confirmOverlayCls} onClick={onCancel}>
      <div className={`${confirmModalCls} max-w-[400px]`} onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-bold text-[#111827]">Konfirmasi Perubahan Harga</h3>
        <p className="text-sm leading-[1.5] text-[#4B5563]">Apakah Anda yakin mengubah:</p>
        <ul className="pl-5 text-sm text-[#374151]">
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
        <div className="mt-2 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-sm border border-[#D1D5DB] bg-white px-4 py-2 text-sm font-semibold text-[#374151]"
          >
            Batal
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-sm bg-[#630ED4] px-4 py-2 text-sm font-semibold text-white"
          >
            Iya
          </button>
        </div>
      </div>
    </div>
  )
}
