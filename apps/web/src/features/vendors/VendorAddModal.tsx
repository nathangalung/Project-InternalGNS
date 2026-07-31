import { useState } from "react"
import Modal from "@/components/shared/Modal"
import { useCreateVendor } from "@/features/vendors/hooks"
import { ApiError } from "@/lib/api-client"
import { ui } from "@/lib/ui"
import type { VendorContactInfo, VendorRow } from "@/types/api"

// Visual disabled treatment, matching lib/styles disabledStyle.
const disabledCls = "disabled:cursor-not-allowed disabled:bg-[#F7F7F8] disabled:opacity-60"

const fieldErrorCls = "mt-1 block text-xs text-[#EF4444]"

const optionalCls = "text-overline font-normal italic text-dark-600"

const inputCls = `${ui.fieldInput} placeholder:text-dark-500 ${disabledCls}`

// Faithful port of the legacy phone-input group.
const phoneWrapCls =
  "flex h-11 overflow-hidden rounded-md border-[1.5px] border-transparent bg-dark-200 transition focus-within:border-primary-600 focus-within:shadow-[0_0_0_3px_rgba(124,58,237,0.12)]"
const phonePrefixCls =
  "flex items-center whitespace-nowrap border-r border-dark-300 px-3 text-sm font-medium text-dark-600"
const phoneInputCls = `min-w-0 flex-1 border-0 bg-transparent px-3 text-sm text-dark-900 outline-none placeholder:text-dark-500 ${disabledCls}`

interface VendorAddModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: (vendor: VendorRow) => void
  /** When true, the overlay won't darken the background (use when opened on top of another modal). */
  nested?: boolean
}

function isValidEmail(s: string): boolean {
  return s.includes("@") && s.split("@").length === 2 && s.split("@")[1].includes(".")
}

function isValidPhone(s: string): boolean {
  const digits = s.replace(/\D/g, "")
  return digits.length >= 9 && digits.length <= 13
}

function isValidAddress(s: string): boolean {
  const t = s.trim()
  return t.length >= 20 && /[a-zA-Z]/.test(t)
}

export default function VendorAddModal({
  open,
  onOpenChange,
  onSuccess,
  nested = false,
}: VendorAddModalProps) {
  const [name, setName] = useState("")
  const [address, setAddress] = useState("")
  const [sku, setSku] = useState("")
  const [email, setEmail] = useState("")
  const [phone, setPhone] = useState("")
  const [isActive, setIsActive] = useState(true)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const createVendor = useCreateVendor()
  const isSaving = createVendor.isPending

  if (!open) return null

  const isNameFilled = name.trim().length > 0
  const isAddressFilled = isNameFilled && isValidAddress(address)
  const addressError =
    isNameFilled && address.trim().length > 0 && !isValidAddress(address)
      ? "Alamat harus minimal 20 karakter dan mengandung huruf."
      : null

  const phoneFilledAndValid = phone.trim().length > 0 && isValidPhone(phone)
  const emailFilledAndValid = email.trim().length > 0 && isValidEmail(email)
  const phoneError =
    isAddressFilled && phone.trim().length > 0 && !isValidPhone(phone)
      ? "Nomor telepon harus 9–13 digit angka."
      : null
  const emailError =
    isAddressFilled && email.trim().length > 0 && !isValidEmail(email)
      ? "Format email tidak valid."
      : null

  const isContactValid = isAddressFilled && (phoneFilledAndValid || emailFilledAndValid)
  const canSubmit = isContactValid

  const reset = () => {
    setName("")
    setAddress("")
    setSku("")
    setEmail("")
    setPhone("")
    setIsActive(true)
    setSubmitError(null)
  }

  const handleCancel = () => {
    if (isSaving) return
    reset()
    onOpenChange(false)
  }

  const handleSubmit = async () => {
    setSubmitError(null)
    if (!canSubmit) return

    const contactInfo: VendorContactInfo = {}
    if (email.trim()) contactInfo.email = email.trim()
    if (phone.trim()) contactInfo.phone = phone.trim()
    if (sku.trim()) contactInfo.sku = sku.trim()

    try {
      const created = await createVendor.mutateAsync({
        name: name.trim(),
        location: address.trim() || undefined,
        contactInfo: Object.keys(contactInfo).length > 0 ? contactInfo : undefined,
        isActive,
      })
      onSuccess?.(created)
      reset()
      onOpenChange(false)
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message || "Gagal menyimpan vendor."
          : "Gagal menyimpan vendor."
      setSubmitError(msg)
    }
  }

  return (
    // When nested, neutralise the shared overlay dimming on Modal's root element.
    <div
      className={
        nested ? "contents [&>div]:bg-transparent [&>div]:[backdrop-filter:none]" : "contents"
      }
    >
      <Modal
        title="Tambah Vendor Baru"
        onClose={handleCancel}
        footer={
          <>
            {submitError && <span className="flex-1 text-xs text-[#EF4444]">{submitError}</span>}
            {!submitError && isAddressFilled && !isContactValid && (
              <span className="flex-1 text-xs text-[#EF4444]">
                Isi minimal email atau nomor telepon.
              </span>
            )}
            <button
              type="button"
              className={ui.modalCancel}
              onClick={handleCancel}
              disabled={isSaving}
            >
              Batal
            </button>
            <button
              type="button"
              className={ui.modalSubmit}
              onClick={handleSubmit}
              disabled={!canSubmit || isSaving}
            >
              {isSaving ? "Menyimpan..." : "Simpan Vendor"}
            </button>
          </>
        }
      >
        <div className={ui.modalSection}>
          <div className={ui.field}>
            <label className={ui.fieldLabel}>
              Nama Vendor <span className="text-primary-700">*</span>
            </label>
            <input
              className={inputCls}
              type="text"
              placeholder="Masukkan nama resmi perusahaan"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className={ui.field}>
            <label className={ui.fieldLabel}>
              Alamat <span className="text-primary-700">*</span>
            </label>
            <textarea
              className={`${inputCls} resize-none leading-5`}
              placeholder="Alamat lengkap kantor pusat atau operasional (min. 20 karakter)"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              rows={3}
              disabled={!isNameFilled}
            />
            {addressError && <span className={fieldErrorCls}>{addressError}</span>}
          </div>
          <div className={ui.field}>
            <label className={ui.fieldLabel}>
              SKU Vendor <span className={optionalCls}>(Opsional)</span>
            </label>
            <input
              className={inputCls}
              type="text"
              placeholder="Masukkan SKU khusus vendor"
              value={sku}
              onChange={(e) => setSku(e.target.value)}
              disabled={!isNameFilled}
            />
          </div>
        </div>

        <div
          className={`${ui.modalSection} transition-opacity duration-200 ease-[ease] ${
            !isAddressFilled ? "opacity-60" : "opacity-100"
          }`}
        >
          <div className={ui.modalSectionHeading}>Informasi Kontak</div>
          <div className={ui.row2}>
            <div className={ui.field}>
              <label className={ui.fieldLabel}>
                Email <span className={optionalCls}>(Opsional)</span>
              </label>
              <input
                className={inputCls}
                type="text"
                placeholder="example@vendor.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={!isAddressFilled}
              />
              {emailError && <span className={fieldErrorCls}>{emailError}</span>}
            </div>
            <div className={ui.field}>
              <label className={ui.fieldLabel}>
                Nomor Telepon <span className={optionalCls}>(Opsional)</span>
              </label>
              <div className={phoneWrapCls}>
                <span className={phonePrefixCls}>+62</span>
                <input
                  className={phoneInputCls}
                  type="tel"
                  inputMode="numeric"
                  placeholder="812xxxx"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
                  disabled={!isAddressFilled}
                />
              </div>
              {phoneError && <span className={fieldErrorCls}>{phoneError}</span>}
            </div>
          </div>
        </div>

        <div className={ui.modalSection}>
          <div className="flex items-center justify-between gap-3 rounded-md border border-[rgba(204,195,216,0.1)] bg-[#F2F4F6] px-3.5 py-2.5">
            <div className="flex-1">
              <div className="text-[13px] font-bold leading-[18px] text-[#191C1E]">
                Status Aktif
              </div>
              <div className="mt-0.5 text-xs font-normal leading-4 text-[#4A4455]">
                Vendor dapat langsung digunakan dalam transaksi procurement.
              </div>
            </div>
            <button
              type="button"
              onClick={() => setIsActive((a) => !a)}
              role="switch"
              aria-checked={isActive}
              className={`relative h-[22px] w-10 shrink-0 cursor-pointer rounded-full transition-[background] duration-200 ease-[ease] ${
                isActive ? "bg-[#630ED4]" : "bg-[#CBD5E1]"
              }`}
            >
              <span
                className={`absolute top-0.5 h-[18px] w-[18px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.15)] transition-[left] duration-200 ease-[ease] ${
                  isActive ? "left-5" : "left-0.5"
                }`}
              />
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
