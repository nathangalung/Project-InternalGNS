import { useState } from "react"
import { useCreateVendor } from "@/features/vendors/hooks"
import { ApiError } from "@/lib/api-client"
import type { VendorContactInfo, VendorRow } from "@/types/api"

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

const disabledStyle = { opacity: 0.6, cursor: "not-allowed" as const, backgroundColor: "#F7F7F8" }

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
    <div
      className="ca-overlay"
      onClick={handleCancel}
      style={nested ? { background: "transparent", backdropFilter: "none" } : undefined}
    >
      <div className="ca-modal" onClick={(e) => e.stopPropagation()}>
        <div className="ca-header">
          <h2 className="ca-title">Tambah Vendor Baru</h2>
          <button className="ca-close-btn" onClick={handleCancel} title="Tutup">
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

        <div className="ca-body">
          <div className="ca-section">
            <div className="ca-field">
              <label className="ca-label">
                Nama Vendor <span className="ca-required">*</span>
              </label>
              <input
                className="ca-input"
                type="text"
                placeholder="Masukkan nama resmi perusahaan"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="ca-field">
              <label className="ca-label">
                Alamat <span className="ca-required">*</span>
              </label>
              <textarea
                className="ca-textarea"
                placeholder="Alamat lengkap kantor pusat atau operasional (min. 20 karakter)"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                rows={3}
                disabled={!isNameFilled}
                style={!isNameFilled ? disabledStyle : undefined}
              />
              {addressError && (
                <span
                  style={{ fontSize: "12px", color: "#EF4444", marginTop: "4px", display: "block" }}
                >
                  {addressError}
                </span>
              )}
            </div>
            <div className="ca-field">
              <label className="ca-label">
                SKU Vendor <span className="ca-optional">(Opsional)</span>
              </label>
              <input
                className="ca-input"
                type="text"
                placeholder="Masukkan SKU khusus vendor"
                value={sku}
                onChange={(e) => setSku(e.target.value)}
                disabled={!isNameFilled}
                style={!isNameFilled ? disabledStyle : undefined}
              />
            </div>
          </div>

          <div
            className="ca-section"
            style={{ opacity: !isAddressFilled ? 0.6 : 1, transition: "opacity 0.2s ease" }}
          >
            <div className="ca-section-heading">Informasi Kontak</div>
            <div className="ca-row-2">
              <div className="ca-field">
                <label className="ca-label">
                  Email <span className="ca-optional">(Opsional)</span>
                </label>
                <input
                  className="ca-input"
                  type="text"
                  placeholder="example@vendor.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={!isAddressFilled}
                  style={!isAddressFilled ? disabledStyle : undefined}
                />
                {emailError && (
                  <span
                    style={{
                      fontSize: "12px",
                      color: "#EF4444",
                      marginTop: "4px",
                      display: "block",
                    }}
                  >
                    {emailError}
                  </span>
                )}
              </div>
              <div className="ca-field">
                <label className="ca-label">
                  Nomor Telepon <span className="ca-optional">(Opsional)</span>
                </label>
                <div className="ca-phone-wrapper">
                  <span className="ca-phone-prefix">+62</span>
                  <input
                    className="ca-phone-input"
                    type="tel"
                    inputMode="numeric"
                    placeholder="812xxxx"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
                    disabled={!isAddressFilled}
                    style={!isAddressFilled ? disabledStyle : undefined}
                  />
                </div>
                {phoneError && (
                  <span
                    style={{
                      fontSize: "12px",
                      color: "#EF4444",
                      marginTop: "4px",
                      display: "block",
                    }}
                  >
                    {phoneError}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="ca-section">
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "12px",
                padding: "10px 14px",
                background: "#F2F4F6",
                border: "1px solid rgba(204, 195, 216, 0.1)",
                borderRadius: "8px",
              }}
            >
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    fontFamily: "'Inter', sans-serif",
                    fontWeight: 700,
                    fontSize: "13px",
                    lineHeight: "18px",
                    color: "#191C1E",
                  }}
                >
                  Status Aktif
                </div>
                <div
                  style={{
                    marginTop: "2px",
                    fontFamily: "'Inter', sans-serif",
                    fontWeight: 400,
                    fontSize: "12px",
                    lineHeight: "16px",
                    color: "#4A4455",
                  }}
                >
                  Vendor dapat langsung digunakan dalam transaksi procurement.
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsActive((a) => !a)}
                role="switch"
                aria-checked={isActive}
                style={{
                  width: "40px",
                  height: "22px",
                  borderRadius: "999px",
                  border: "none",
                  background: isActive ? "#630ED4" : "#CBD5E1",
                  cursor: "pointer",
                  position: "relative",
                  transition: "background 0.2s",
                  flexShrink: 0,
                }}
              >
                <span
                  style={{
                    position: "absolute",
                    top: "2px",
                    left: isActive ? "20px" : "2px",
                    width: "18px",
                    height: "18px",
                    borderRadius: "50%",
                    background: "#FFFFFF",
                    transition: "left 0.2s",
                    boxShadow: "0 1px 3px rgba(0,0,0,0.15)",
                  }}
                />
              </button>
            </div>
          </div>
        </div>

        <div className="ca-footer" style={{ padding: "16px 24px" }}>
          {submitError && (
            <span style={{ fontSize: "12px", color: "#EF4444", flex: 1 }}>{submitError}</span>
          )}
          {!submitError && isAddressFilled && !isContactValid && (
            <span style={{ fontSize: "12px", color: "#EF4444", flex: 1 }}>
              Isi minimal email atau nomor telepon.
            </span>
          )}
          <button
            type="button"
            className="ca-btn-cancel"
            onClick={handleCancel}
            disabled={isSaving}
            style={{ padding: "8px 18px", fontSize: "13px" }}
          >
            Batal
          </button>
          <button
            type="button"
            className="ca-btn-submit"
            onClick={handleSubmit}
            disabled={!canSubmit || isSaving}
            style={{
              padding: "8px 22px",
              fontSize: "13px",
              opacity: !canSubmit || isSaving ? 0.5 : 1,
              cursor: !canSubmit || isSaving ? "not-allowed" : "pointer",
            }}
          >
            {isSaving ? "Menyimpan..." : "Simpan Vendor"}
          </button>
        </div>
      </div>
    </div>
  )
}
