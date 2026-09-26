import { useId } from "react"
import Modal from "@/components/shared/Modal"
import { ui } from "@/lib/ui"
import type { NewVendorForm } from "./helpers"

type VendorAddModalProps = {
  open: boolean
  form: NewVendorForm
  onChange: (next: NewVendorForm) => void
  onClose: () => void
  onSubmit: () => void
  isSaving?: boolean
  error?: string | null
}

// New vendor inline modal.
export default function VendorAddModal({
  open,
  form,
  onChange,
  onClose,
  onSubmit,
  isSaving,
  error,
}: VendorAddModalProps) {
  const nameId = useId()
  const priceId = useId()
  if (!open) return null
  const trimmed = form.nama.trim()
  const hargaVal = Number(form.harga)
  const isHargaValid = hargaVal > 0
  const disableSubmit = !trimmed || !isHargaValid || Boolean(isSaving)
  return (
    <Modal
      title="Tambah Vendor Baru"
      onClose={onClose}
      className="max-w-[min(520px,92vw)]!"
      footer={
        <>
          {(error || (trimmed && !isHargaValid)) && (
            <span role="alert" className="flex-1 text-[12px] text-error">
              {error ?? "Harga beli harus lebih dari 0"}
            </span>
          )}
          <div className="flex gap-4 max-sm:w-full max-sm:*:flex-1 max-sm:*:px-4">
            <button type="button" className={ui.modalCancel} onClick={onClose} disabled={isSaving}>
              Batal
            </button>
            <button
              type="button"
              className={ui.modalSubmit}
              onClick={onSubmit}
              disabled={disableSubmit}
            >
              {isSaving ? "Menyimpan..." : "Simpan"}
            </button>
          </div>
        </>
      }
    >
      <div className={ui.modalSection}>
        <div className={ui.field}>
          <label htmlFor={nameId} className={ui.fieldLabel}>
            Nama Vendor <span className="text-primary-700">*</span>
          </label>
          <input
            id={nameId}
            className={`${ui.fieldInput} font-sans`}
            type="text"
            placeholder="Masukkan nama vendor"
            value={form.nama}
            onChange={(e) => onChange({ ...form, nama: e.target.value })}
          />
        </div>
        <div className={ui.field}>
          <label htmlFor={priceId} className={ui.fieldLabel}>
            Harga Beli (Rp) <span className="text-primary-700">*</span>
          </label>
          <input
            id={priceId}
            className={`${ui.fieldInput} font-sans`}
            type="number"
            min={0}
            placeholder="Masukkan harga beli"
            value={form.harga}
            onChange={(e) => onChange({ ...form, harga: e.target.value })}
          />
        </div>
      </div>
    </Modal>
  )
}
