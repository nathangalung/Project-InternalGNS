import { useEffect, useId, useState } from "react"
import Modal from "@/components/shared/Modal"
import { parsePercent, percentShown } from "@/lib/percent-input"
import { ui } from "@/lib/ui"

type DiscountModalProps = {
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
  const inputId = useId()
  const errorId = useId()
  const [tempDiscount, setTempDiscount] = useState<string>("")

  // Sync input on open.
  useEffect(() => {
    if (open) {
      setTempDiscount(percentShown(initialDiscount))
    }
  }, [open, initialDiscount])

  if (!open) return null

  // A comma or a dot starts the decimals, 0 to 100.
  const parsed = parsePercent(tempDiscount)
  const error = "error" in parsed ? parsed.error : null

  function handleSaveDiscount() {
    if ("error" in parsed) return
    onSuccess(Number(parsed.value ?? 0))
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
          <button
            type="button"
            className={ui.modalSubmit}
            onClick={handleSaveDiscount}
            disabled={error !== null}
          >
            Simpan Data
          </button>
        </>
      }
    >
      <div className={ui.modalSection}>
        <div className={ui.modalSectionHeading}>DISKON</div>
        <div className={ui.field}>
          <label htmlFor={inputId} className={ui.fieldLabel}>
            Persentase Diskon <span className="text-primary-700">*</span>
          </label>
          <input
            id={inputId}
            type="text"
            inputMode="decimal"
            placeholder="Masukkan persentase diskon, contoh 5 atau 2,5"
            value={tempDiscount}
            onChange={(e) => setTempDiscount(e.target.value)}
            className={`${ui.fieldInput} ${error ? "border-error" : ""}`}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
          />
          {error && (
            <p id={errorId} className="m-0 text-[12px] text-error">
              {error}
            </p>
          )}
        </div>
      </div>
    </Modal>
  )
}
