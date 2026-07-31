import { useEffect, useState } from "react"

interface DiscountModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialDiscount: number
  onSuccess: (discount: number) => void
}

export default function DiscountModal({
  open,
  onOpenChange,
  initialDiscount,
  onSuccess,
}: DiscountModalProps) {
  const [tempDiscount, setTempDiscount] = useState<string>("")

  // Sync input on open.
  useEffect(() => {
    if (open) {
      setTempDiscount(initialDiscount > 0 ? String(initialDiscount) : "")
    }
  }, [open, initialDiscount])

  if (!open) return null

  function handleSaveDiscount() {
    const val = parseFloat(tempDiscount)
    onSuccess(Number.isNaN(val) || val < 0 ? 0 : val)
  }

  return (
    <div className="ca-overlay z-[9999]" onClick={() => onOpenChange(false)}>
      <div
        className="ca-modal w-full max-w-[520px] overflow-hidden rounded-lg p-0 shadow-[0_20px_25px_-5px_rgba(0,0,0,0.1),0_10px_10px_-5px_rgba(0,0,0,0.04)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header Pop-Up */}
        <div className="flex items-center justify-between px-6 pb-4 pt-6">
          <h2 className="m-0 text-xl font-bold text-[#111827]">Tambah Diskon Pembayaran</h2>
          <button type="button" className="flex p-0" onClick={() => onOpenChange(false)}>
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#6B7280"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>

        {/* Body Pop-Up */}
        <div className="px-6 pb-8">
          <div className="mb-3 text-[11px] font-bold uppercase tracking-[1px] text-[#630ED4]">
            DISKON
          </div>
          <div className="mb-5 h-px bg-[#F3F4F6]"></div>

          <label className="mb-2 block text-sm font-semibold text-[#111827]">
            Persentase Diskon <span className="text-error">*</span>
          </label>
          <input
            type="number"
            min="0"
            max="100"
            placeholder="Masukkan persentase diskon (contoh: 5 untuk diskon 5%)"
            value={tempDiscount}
            onChange={(e) => setTempDiscount(e.target.value)}
            className="box-border w-full rounded-md bg-dark-200 px-4 py-3 text-sm text-[#111827] outline-none"
          />
        </div>

        {/* Footer Pop-Up */}
        <div className="flex justify-end gap-4 bg-dark-50 px-6 py-4">
          <button
            type="button"
            className="text-sm font-bold text-[#374151]"
            onClick={() => onOpenChange(false)}
          >
            Batal
          </button>
          <button
            type="button"
            className="rounded-md bg-[#630ED4] px-6 py-2.5 text-sm font-semibold text-white"
            onClick={handleSaveDiscount}
          >
            Simpan Data
          </button>
        </div>
      </div>
    </div>
  )
}
