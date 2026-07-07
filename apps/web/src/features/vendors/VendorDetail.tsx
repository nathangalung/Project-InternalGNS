import { type CSSProperties, useEffect, useRef, useState } from "react"
import Sidebar from "@/components/shared/Sidebar"
import {
  useUpdateVendor,
  useUploadVendorLogo,
  useVendorItems,
  useVendorLogoDownloadUrl,
} from "@/features/vendors/hooks"
import { ApiError, fetchObjectUrl } from "@/lib/api-client"
import { logoBackground } from "@/lib/avatar"
import { formatRupiah } from "@/lib/format"
import type { Page } from "@/lib/page"
import type { VendorContactInfo, VendorRow } from "@/types/api"

interface VendorDetailProps {
  vendor: VendorRow
  onNavigate: (page: Page) => void
  onBack: () => void
  onLogout: () => void
}

function vendorInitials(name: string): string {
  const parts = name
    .replace(/^PT\.?\s+/i, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (parts.length === 0) return "?"
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

function getContactField(
  contactInfo: VendorContactInfo | undefined,
  key: "email" | "phone",
): string {
  return contactInfo?.[key] ?? ""
}

const labelStyle: CSSProperties = {
  fontFamily: "'Inter', sans-serif",
  fontWeight: 700,
  fontSize: "10px",
  lineHeight: "15px",
  letterSpacing: "1px",
  textTransform: "uppercase",
  color: "#4A4455",
  display: "block",
  marginBottom: "8px",
}

const inputStyle: CSSProperties = {
  width: "100%",
  height: "44px",
  padding: "12px 16px",
  background: "#F2F4F6",
  borderRadius: "8px",
  border: "1.5px solid transparent",
  fontFamily: "'Inter', sans-serif",
  fontSize: "14px",
  fontWeight: 500,
  color: "#191C1E",
  outline: "none",
  transition: "border-color 0.15s",
}

export default function VendorDetail({ vendor, onNavigate, onBack, onLogout }: VendorDetailProps) {
  const initialEmail = getContactField(vendor.contactInfo, "email")
  const initialPhone = getContactField(vendor.contactInfo, "phone")

  const [name, setName] = useState(vendor.name)
  const [phone, setPhone] = useState(initialPhone)
  const [email, setEmail] = useState(initialEmail)
  const [address, setAddress] = useState(vendor.location ?? "")
  const [isActive, setIsActive] = useState(vendor.isActive)
  const [logoDataUrl, setLogoDataUrl] = useState<string>("")
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const fileInputRef = useRef<HTMLInputElement>(null)

  const updateVendor = useUpdateVendor()
  const uploadLogo = useUploadVendorLogo()
  const { data: logoDownload } = useVendorLogoDownloadUrl(vendor.id, vendor.logoObjectKey)
  const { data: vendorItems, isLoading: itemsLoading } = useVendorItems(vendor.id)

  useEffect(() => {
    const path = logoDownload?.downloadUrl
    if (!path) {
      if (!vendor.logoObjectKey) setLogoDataUrl("")
      return
    }
    let active = true
    let objectUrl = ""
    fetchObjectUrl(path)
      .then((u) => {
        if (active) {
          objectUrl = u
          setLogoDataUrl(u)
        } else {
          URL.revokeObjectURL(u)
        }
      })
      .catch(() => {})
    return () => {
      active = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [logoDownload?.downloadUrl, vendor.logoObjectKey])

  useEffect(() => {
    setName(vendor.name)
    setPhone(getContactField(vendor.contactInfo, "phone"))
    setEmail(getContactField(vendor.contactInfo, "email"))
    setAddress(vendor.location ?? "")
    setIsActive(vendor.isActive)
  }, [vendor.name, vendor.contactInfo, vendor.location, vendor.isActive])

  const dirty =
    name !== vendor.name ||
    phone !== initialPhone ||
    email !== initialEmail ||
    address !== (vendor.location ?? "") ||
    isActive !== vendor.isActive

  const logoBg = logoBackground(vendor.name)

  function handleLogoSelect(file: File | undefined) {
    if (!file) return
    if (!file.type.startsWith("image/")) return
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === "string") setLogoDataUrl(reader.result)
    }
    reader.readAsDataURL(file)
    uploadLogo.mutate({ id: vendor.id, file })
  }

  const handleCancel = () => {
    setName(vendor.name)
    setPhone(initialPhone)
    setEmail(initialEmail)
    setAddress(vendor.location ?? "")
    setIsActive(vendor.isActive)
    setFieldErrors({})
    setSubmitError(null)
  }

  const handleSubmit = async () => {
    setSubmitError(null)
    const errs: Record<string, string> = {}
    if (!name.trim()) errs.name = "Wajib diisi"
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs)
      return
    }
    const contactInfo: VendorContactInfo = { ...vendor.contactInfo }
    if (email.trim()) contactInfo.email = email.trim()
    if (phone.trim()) contactInfo.phone = phone.trim()
    try {
      await updateVendor.mutateAsync({
        id: vendor.id,
        input: {
          name: name.trim(),
          location: address.trim() || undefined,
          contactInfo: Object.keys(contactInfo).length > 0 ? contactInfo : undefined,
          isActive,
        },
      })
      setFieldErrors({})
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message || "Gagal menyimpan perubahan"
          : "Gagal menyimpan perubahan"
      setSubmitError(msg)
    }
  }

  return (
    <div className="admin-shell">
      <Sidebar activePage={"vendors" as Page} onNavigate={onNavigate} onLogout={onLogout} />

      <div className="admin-main">
        <div className="page-content" style={{ gap: "29px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <nav className="qd-breadcrumb">
              <button className="qd-breadcrumb-link" onClick={onBack}>
                Daftar Vendor
              </button>
              <span className="qd-breadcrumb-sep">&rsaquo;</span>
              <span className="qd-breadcrumb-current">Detail Vendor</span>
            </nav>

            <div style={{ display: "flex", alignItems: "center", gap: "20px" }}>
              <button
                type="button"
                onClick={onBack}
                style={{
                  width: "40px",
                  height: "40px",
                  background: "#FFFFFF",
                  boxShadow: "0px 1px 2px rgba(0, 0, 0, 0.05)",
                  borderRadius: "8px",
                  border: "none",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#4A4455"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="19" y1="12" x2="5" y2="12" />
                  <polyline points="12 19 5 12 12 5" />
                </svg>
              </button>
              <h1 className="page-title" style={{ margin: 0 }}>
                Detail Vendor
              </h1>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
            <div
              style={{
                background: "#FFFFFF",
                borderRadius: "12px",
                padding: "20px 24px",
                display: "flex",
                alignItems: "center",
                gap: "20px",
              }}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={(e) => {
                  handleLogoSelect(e.target.files?.[0])
                  e.target.value = ""
                }}
              />
              <div style={{ position: "relative", flexShrink: 0 }}>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  title="Klik untuk ganti logo"
                  style={{
                    width: "64px",
                    height: "64px",
                    borderRadius: "12px",
                    background: logoDataUrl ? "#FFFFFF" : logoBg,
                    color: "#FFFFFF",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontFamily: "'Inter', sans-serif",
                    fontWeight: 800,
                    fontSize: "20px",
                    letterSpacing: "0.5px",
                    border: "none",
                    cursor: "pointer",
                    overflow: "hidden",
                    padding: 0,
                  }}
                >
                  {logoDataUrl ? (
                    <img
                      src={logoDataUrl}
                      alt="Logo vendor"
                      style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    />
                  ) : (
                    vendorInitials(vendor.name)
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  title="Ganti logo"
                  aria-label="Ganti logo"
                  style={{
                    position: "absolute",
                    bottom: "-4px",
                    right: "-4px",
                    width: "26px",
                    height: "26px",
                    borderRadius: "50%",
                    background: "#FFFFFF",
                    border: "2px solid #FFFFFF",
                    boxShadow: "0 2px 6px rgba(0, 0, 0, 0.15)",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: 0,
                  }}
                >
                  <span
                    style={{
                      width: "100%",
                      height: "100%",
                      borderRadius: "50%",
                      background: "linear-gradient(135deg, #630ED4 0%, #7C3AED 100%)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <svg
                      width="13"
                      height="13"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="#FFFFFF"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                      <circle cx="12" cy="13" r="3.5" />
                    </svg>
                  </span>
                </button>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <h2
                  style={{
                    margin: 0,
                    fontFamily: "'Inter', sans-serif",
                    fontWeight: 700,
                    fontSize: "18px",
                    lineHeight: "24px",
                    letterSpacing: "-0.4px",
                    color: "#191C1E",
                    wordBreak: "break-word",
                  }}
                >
                  {vendor.name}
                </h2>
                <span
                  style={{
                    fontFamily: "'Inter', sans-serif",
                    fontWeight: 500,
                    fontSize: "13px",
                    lineHeight: "18px",
                    color: "#4A4455",
                  }}
                >
                  Vendor
                </span>
              </div>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "2px",
                  padding: "10px 16px",
                  background: vendor.isActive ? "#F0FDF4" : "#FEF2F2",
                  border: `1px solid ${vendor.isActive ? "#BBF7D0" : "#FECACA"}`,
                  borderRadius: "10px",
                  flexShrink: 0,
                }}
              >
                <span
                  style={{
                    fontFamily: "'Inter', sans-serif",
                    fontWeight: 600,
                    fontSize: "9px",
                    letterSpacing: "1.4px",
                    textTransform: "uppercase",
                    color: "#64748B",
                    lineHeight: "11px",
                  }}
                >
                  Status
                </span>
                <span
                  style={{
                    fontFamily: "'Inter', sans-serif",
                    fontWeight: 800,
                    fontSize: "13px",
                    letterSpacing: "0.2px",
                    color: vendor.isActive ? "#065F46" : "#991B1B",
                    lineHeight: "16px",
                  }}
                >
                  {vendor.isActive ? "Aktif" : "Nonaktif"}
                </span>
              </div>
            </div>

            <div
              style={{
                background: "#FFFFFF",
                borderRadius: "12px",
                padding: "32px",
                display: "flex",
                flexDirection: "column",
                gap: "32px",
              }}
            >
              <div>
                <h3
                  style={{
                    margin: 0,
                    fontFamily: "'Inter', sans-serif",
                    fontWeight: 700,
                    fontSize: "20px",
                    lineHeight: "28px",
                    letterSpacing: "-0.5px",
                    color: "#191C1E",
                  }}
                >
                  Informasi Utama Vendor
                </h3>
                <p
                  style={{
                    margin: "4px 0 0 0",
                    fontFamily: "'Inter', sans-serif",
                    fontWeight: 400,
                    fontSize: "14px",
                    lineHeight: "20px",
                    color: "#4A4455",
                  }}
                >
                  Kelola informasi vendor.
                </p>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
                <div>
                  <label style={labelStyle}>
                    Nama Vendor <span style={{ color: "#DC2626" }}>*</span>
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => {
                      setName(e.target.value)
                      setFieldErrors((p) => ({ ...p, name: "" }))
                    }}
                    style={{
                      ...inputStyle,
                      borderColor: fieldErrors.name ? "#DC2626" : "transparent",
                    }}
                  />
                  {fieldErrors.name && (
                    <div
                      style={{
                        marginTop: "6px",
                        fontSize: "12px",
                        color: "#DC2626",
                        fontFamily: "'Inter', sans-serif",
                      }}
                    >
                      {fieldErrors.name}
                    </div>
                  )}
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" }}>
                  <div>
                    <label style={labelStyle}>No HP</label>
                    <div
                      style={{
                        display: "flex",
                        borderRadius: "8px",
                        overflow: "hidden",
                        height: "44px",
                      }}
                    >
                      <span
                        style={{
                          background: "#E6E8EA",
                          padding: "0 12px",
                          fontFamily: "'Inter', sans-serif",
                          fontWeight: 500,
                          fontSize: "14px",
                          color: "#4A4455",
                          display: "flex",
                          alignItems: "center",
                          whiteSpace: "nowrap",
                          flexShrink: 0,
                        }}
                      >
                        +62
                      </span>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={phone}
                        placeholder="81234567890"
                        onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
                        style={{
                          ...inputStyle,
                          height: "100%",
                          borderRadius: 0,
                          flex: 1,
                          minWidth: 0,
                        }}
                      />
                    </div>
                  </div>
                  <div>
                    <label style={labelStyle}>Email</label>
                    <input
                      type="email"
                      value={email}
                      placeholder="contact@vendor.com"
                      onChange={(e) => setEmail(e.target.value)}
                      style={inputStyle}
                    />
                  </div>
                </div>

                <div>
                  <label style={labelStyle}>Alamat Rinci</label>
                  <textarea
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    rows={3}
                    placeholder="Alamat lengkap kantor pusat atau operasional"
                    style={{
                      ...inputStyle,
                      height: "auto",
                      minHeight: "96px",
                      padding: "12px 16px",
                      resize: "vertical",
                      fontFamily: "'Inter', sans-serif",
                    }}
                  />
                </div>
              </div>

              <div style={{ borderTop: "1px solid #ECEEF0", paddingTop: "24px" }}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: "24px",
                    padding: "20px 24px",
                    background: "#F2F4F6",
                    borderRadius: "8px",
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <div
                      style={{
                        fontFamily: "'Inter', sans-serif",
                        fontWeight: 700,
                        fontSize: "14px",
                        lineHeight: "20px",
                        color: "#191C1E",
                      }}
                    >
                      Status Akun
                    </div>
                    <div
                      style={{
                        marginTop: "4px",
                        fontFamily: "'Inter', sans-serif",
                        fontWeight: 400,
                        fontSize: "12px",
                        lineHeight: "16px",
                        color: "#4A4455",
                      }}
                    >
                      Menonaktifkan vendor mencegah penggunaan dalam transaksi procurement
                      berikutnya.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsActive((a) => !a)}
                    role="switch"
                    aria-checked={isActive}
                    style={{
                      width: "56px",
                      height: "32px",
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
                        top: "4px",
                        left: isActive ? "28px" : "4px",
                        width: "24px",
                        height: "24px",
                        borderRadius: "50%",
                        background: "#FFFFFF",
                        transition: "left 0.2s",
                        boxShadow: "0 1px 3px rgba(0,0,0,0.15)",
                      }}
                    />
                  </button>
                </div>
              </div>

              {submitError && (
                <div
                  style={{
                    padding: "12px 16px",
                    background: "#FEF2F2",
                    borderLeft: "4px solid #DC2626",
                    borderRadius: "8px",
                    fontFamily: "'Inter', sans-serif",
                    fontSize: "13px",
                    color: "#7F1D1D",
                  }}
                >
                  {submitError}
                </div>
              )}
            </div>
          </div>

          <div
            style={{ display: "flex", justifyContent: "flex-end", gap: "16px", marginTop: "8px" }}
          >
            <button
              type="button"
              onClick={handleCancel}
              disabled={!dirty || updateVendor.isPending}
              style={{
                padding: "12px 28px",
                borderRadius: "12px",
                border: "none",
                background: "transparent",
                color: dirty && !updateVendor.isPending ? "#630ED4" : "#CBD5E1",
                fontFamily: "'Inter', sans-serif",
                fontWeight: 700,
                fontSize: "14px",
                cursor: dirty && !updateVendor.isPending ? "pointer" : "default",
              }}
            >
              Batal
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!dirty || updateVendor.isPending}
              style={{
                padding: "12px 32px",
                borderRadius: "12px",
                border: "none",
                background: dirty ? "linear-gradient(135deg, #630ED4 0%, #7C3AED 100%)" : "#CBD5E1",
                boxShadow: dirty
                  ? "0px 10px 15px -3px rgba(99, 14, 212, 0.2), 0px 4px 6px -4px rgba(99, 14, 212, 0.2)"
                  : "none",
                color: "#FFFFFF",
                fontFamily: "'Inter', sans-serif",
                fontWeight: 700,
                fontSize: "14px",
                cursor: dirty && !updateVendor.isPending ? "pointer" : "default",
                opacity: updateVendor.isPending ? 0.7 : 1,
              }}
            >
              {updateVendor.isPending ? "Menyimpan…" : "Simpan Perubahan"}
            </button>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "16px", marginTop: "8px" }}>
            <h3
              style={{
                margin: 0,
                fontFamily: "'Inter', sans-serif",
                fontWeight: 800,
                fontSize: "20px",
                lineHeight: "28px",
                letterSpacing: "-0.5px",
                color: "#191C1E",
              }}
            >
              Daftar Produk Vendor
            </h3>

            <div className="tbl-container" style={{ marginTop: 0 }}>
              <table className="tbl">
                <thead>
                  <tr className="tbl-header-row">
                    <th className="tbl-th tbl-th--center" style={{ width: 360 }}>
                      Nama Produk
                    </th>
                    <th className="tbl-th tbl-th--center" style={{ width: 200 }}>
                      Kode IMPA
                    </th>
                    <th className="tbl-th tbl-th--center" style={{ width: 200 }}>
                      SKU Vendor
                    </th>
                    <th className="tbl-th tbl-th--center" style={{ width: 200 }}>
                      Harga Beli
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {itemsLoading && (
                    <tr>
                      <td
                        colSpan={4}
                        className="tbl-td tbl-td--center"
                        style={{ padding: "40px 0", color: "#64748B" }}
                      >
                        Memuat data…
                      </td>
                    </tr>
                  )}
                  {!itemsLoading && (vendorItems ?? []).length === 0 && (
                    <tr>
                      <td
                        colSpan={4}
                        className="tbl-td tbl-td--center"
                        style={{ padding: "40px 0", color: "#64748B" }}
                      >
                        Belum ada produk vendor.
                      </td>
                    </tr>
                  )}
                  {!itemsLoading &&
                    (vendorItems ?? []).map((item) => (
                      <tr key={item.itemId} className="tbl-row">
                        <td className="tbl-td tbl-td--client tbl-td--center">{item.itemName}</td>
                        <td className="tbl-td tbl-td--center">{item.impaCode ?? "-"}</td>
                        <td className="tbl-td tbl-td--center">{item.vendorSku ?? "-"}</td>
                        <td
                          className="tbl-td tbl-td--center"
                          style={{ fontWeight: 800, color: "#630ED4" }}
                        >
                          {formatRupiah(item.costPrice, "-")}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
