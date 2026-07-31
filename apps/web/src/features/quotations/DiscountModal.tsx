import { useEffect, useState } from "react"
import Modal from "@/components/shared/Modal"
import { ui } from "@/lib/ui"

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
    <Modal
      title="Tambah Diskon Pembayaran"
      onClose={() => onOpenChange(false)}
      className="max-w-[min(520px,92vw)]!"
      footer={
        <>
          <button type="button" className={ui.modalCancel} onClick={() => onOpenChange(false)}>
            Batal
          </button>
          <button type="button" className={ui.modalSubmit} onClick={handleSaveDiscount}>
            Simpan Data
          </button>
        </>
      }
    >
      <div className={ui.modalSection}>
        <div className={ui.modalSectionHeading}>DISKON</div>
        <div className={ui.field}>
          <label className={ui.fieldLabel}>
            Persentase Diskon <span className="text-primary-700">*</span>
          </label>
          <input
            type="number"
            min="0"
            max="100"
            placeholder="Masukkan persentase diskon (contoh: 5 untuk diskon 5%)"
            value={tempDiscount}
            onChange={(e) => setTempDiscount(e.target.value)}
            className={ui.fieldInput}
          />
        </div>
      </div>
    </Modal>
  )
}
