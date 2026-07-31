import { ui } from "@/lib/ui"
import { confirmModalCls, confirmOverlayCls, type NewVendorForm } from "./helpers"

interface VendorAddModalProps {
  open: boolean
  form: NewVendorForm
  onChange: (next: NewVendorForm) => void
  onClose: () => void
  onSubmit: () => void
  isSaving?: boolean
  error?: string | null
}

const fieldLabelCls = "mb-1.5 block text-[11px] font-bold uppercase text-[#6B7280]"

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
  if (!open) return null
  const trimmed = form.nama.trim()
  const hargaVal = Number(form.harga)
  const isHargaValid = hargaVal > 0
  const disableSubmit = !trimmed || !isHargaValid || Boolean(isSaving)
  return (
    <div className={confirmOverlayCls} onClick={onClose}>
      <div className={`${confirmModalCls} max-w-[480px]`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-[#111827]">Tambah Vendor Baru</h3>
          <button type="button" onClick={onClose} className="text-[#6B7280]">
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <line x1="1" y1="1" x2="13" y2="13" />
              <line x1="13" y1="1" x2="1" y2="13" />
            </svg>
          </button>
        </div>
        <div className="flex flex-col gap-4">
          <div>
            <label className={fieldLabelCls}>
              Nama Vendor <span className="text-error">*</span>
            </label>
            <input
              className={`${ui.fieldInput} font-sans`}
              type="text"
              placeholder="Masukkan nama vendor"
              value={form.nama}
              onChange={(e) => onChange({ ...form, nama: e.target.value })}
            />
          </div>
          <div>
            <label className={fieldLabelCls}>
              Harga Beli (Rp) <span className="text-error">*</span>
            </label>
            <input
              className={`${ui.fieldInput} font-sans`}
              type="number"
              min={0}
              placeholder="Masukkan harga beli"
              value={form.harga}
              onChange={(e) => onChange({ ...form, harga: e.target.value })}
            />
          </div>
        </div>
        {error && <div className="text-[12px] text-error">{error}</div>}
        {trimmed && !isHargaValid && (
          <div className="text-[12px] text-error">Harga beli harus lebih dari 0</div>
        )}
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="rounded-sm border border-[#D1D5DB] bg-white px-4 py-2 text-sm font-semibold text-[#374151] disabled:cursor-not-allowed"
          >
            Batal
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={disableSubmit}
            className="rounded-sm bg-[#630ED4] px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSaving ? "Menyimpan..." : "Simpan"}
          </button>
        </div>
      </div>
    </div>
  )
}
