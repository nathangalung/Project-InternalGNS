import { type CSSProperties, useEffect, useRef, useState } from "react"
import { CheckIcon } from "@/components/document/icons"
import { dropdownItemStyle, dropdownLabelStyle } from "@/components/shared/filter-styles"
import Sidebar from "@/components/shared/Sidebar"
import { getCompanyInitials } from "@/features/clients/helpers"
import {
  useClientLogoDownloadUrl,
  useUpdateClient,
  useUploadClientLogo,
} from "@/features/clients/hooks"
import { useCountries } from "@/features/countries/hooks"
import { ApiError } from "@/lib/api-client"
import { logoBackground } from "@/lib/avatar"
import type { Page } from "@/lib/page"
import type { ClientRow } from "@/types/api"

interface ClientDetailProps {
  client: ClientRow
  onNavigate: (page: Page) => void
  onBack: () => void
  onLogout: () => void
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

const dropdownPanelStyle: CSSProperties = {
  position: "absolute",
  top: "calc(100% + 4px)",
  left: 0,
  right: 0,
  background: "#FFFFFF",
  border: "1px solid rgba(204, 195, 216, 0.2)",
  boxShadow: "0 4px 12px rgba(0, 0, 0, 0.08)",
  borderRadius: "8px",
  display: "flex",
  flexDirection: "column",
  padding: "4px 0",
  zIndex: 50,
  maxHeight: "260px",
  overflowY: "auto",
}

export default function ClientDetail({ client, onNavigate, onBack, onLogout }: ClientDetailProps) {
  const [name, setName] = useState(client.name)
  const [tkuId, setTkuId] = useState(client.tkuId ?? "")
  const [countryCode, setCountryCode] = useState(client.countryCode)
  const [phone, setPhone] = useState(client.contactPhone ?? "")
  const [email, setEmail] = useState(client.email ?? "")
  const [npwp, setNpwp] = useState(client.npwp ?? "")
  const [address, setAddress] = useState(client.address ?? "")
  const [isActive, setIsActive] = useState(client.isActive)
  const [logoDataUrl, setLogoDataUrl] = useState<string>("")
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [countryOpen, setCountryOpen] = useState(false)
  const [countryQuery, setCountryQuery] = useState("")
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  const { data: countries } = useCountries()
  const updateClient = useUpdateClient()
  const uploadLogo = useUploadClientLogo()
  const { data: logoDownload } = useClientLogoDownloadUrl(client.id, client.logoObjectKey)

  useEffect(() => {
    if (logoDownload?.downloadUrl) setLogoDataUrl(logoDownload.downloadUrl)
    else if (!client.logoObjectKey) setLogoDataUrl("")
  }, [logoDownload?.downloadUrl, client.logoObjectKey])

  useEffect(() => {
    setName(client.name)
    setTkuId(client.tkuId ?? "")
    setCountryCode(client.countryCode)
    setPhone(client.contactPhone ?? "")
    setEmail(client.email ?? "")
    setNpwp(client.npwp ?? "")
    setAddress(client.address ?? "")
    setIsActive(client.isActive)
  }, [
    client.name,
    client.tkuId,
    client.countryCode,
    client.contactPhone,
    client.email,
    client.npwp,
    client.address,
    client.isActive,
  ])

  const dirty =
    name !== client.name ||
    tkuId !== (client.tkuId ?? "") ||
    countryCode !== client.countryCode ||
    email !== (client.email ?? "") ||
    npwp !== (client.npwp ?? "") ||
    address !== (client.address ?? "") ||
    isActive !== client.isActive

  const countryOption = countries?.find((c) => c.code === countryCode)
  const dialCode = countryOption?.dialCode ?? ""

  const handleCancel = () => {
    setName(client.name)
    setTkuId(client.tkuId ?? "")
    setCountryCode(client.countryCode)
    setPhone(client.contactPhone ?? "")
    setEmail(client.email ?? "")
    setNpwp(client.npwp ?? "")
    setAddress(client.address ?? "")
    setIsActive(client.isActive)
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
    try {
      await updateClient.mutateAsync({
        id: client.id,
        input: {
          name: name.trim(),
          npwp: npwp.trim() || undefined,
          address: address.trim() || undefined,
          email: email.trim() || undefined,
          countryCode,
          tkuId: tkuId.trim() || undefined,
          isActive,
        },
      })
      setFieldErrors({})
    } catch (err) {
      if (err instanceof ApiError) {
        setSubmitError(err.message || "Gagal menyimpan perubahan")
      } else {
        setSubmitError("Gagal menyimpan perubahan")
      }
    }
  }

  const logoBg = logoBackground(client.name)

  function handleLogoSelect(file: File | undefined) {
    if (!file) return
    if (!file.type.startsWith("image/")) return
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === "string") setLogoDataUrl(reader.result)
    }
    reader.readAsDataURL(file)
    uploadLogo.mutate({ id: client.id, file })
  }

  return (
    <div className="admin-shell">
      <Sidebar activePage={"clients" as Page} onNavigate={onNavigate} onLogout={onLogout} />

      <div className="admin-main">
        <div className="page-content" style={{ gap: "29px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <nav className="qd-breadcrumb">
              <button className="qd-breadcrumb-link" onClick={onBack}>
                Daftar Klien
              </button>
              <span className="qd-breadcrumb-sep">&rsaquo;</span>
              <span className="qd-breadcrumb-current">Detail Klien</span>
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
                Detail Klien
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
                      alt="Logo klien"
                      style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    />
                  ) : (
                    getCompanyInitials(client.name)
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
                  {client.name}
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
                  Klien
                </span>
              </div>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "2px",
                  padding: "10px 16px",
                  background: client.isActive ? "#F0FDF4" : "#FEF2F2",
                  border: `1px solid ${client.isActive ? "#BBF7D0" : "#FECACA"}`,
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
                    color: client.isActive ? "#065F46" : "#991B1B",
                    lineHeight: "16px",
                  }}
                >
                  {client.isActive ? "Aktif" : "Nonaktif"}
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
                  Informasi Utama Klien
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
                  Kelola informasi klien.
                </p>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
                <div>
                  <label style={labelStyle}>
                    Nama Klien <span style={{ color: "#DC2626" }}>*</span>
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
                    <label style={labelStyle}>Nomor TKU</label>
                    <input
                      type="text"
                      value={tkuId}
                      placeholder="Masukkan TKU"
                      onChange={(e) => setTkuId(e.target.value)}
                      style={inputStyle}
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>Kode Negara</label>
                    <div style={{ position: "relative" }}>
                      <button
                        type="button"
                        onClick={() => setCountryOpen((o) => !o)}
                        style={{
                          width: "100%",
                          height: "44px",
                          padding: "12px 16px",
                          background: "#F2F4F6",
                          border: "1.5px solid transparent",
                          borderRadius: "8px",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          cursor: "pointer",
                          fontFamily: "'Inter', sans-serif",
                          fontWeight: 500,
                          fontSize: "14px",
                          color: "#191C1E",
                        }}
                      >
                        <span>
                          {countryOption
                            ? `${countryOption.code} - ${countryOption.name}`
                            : countryCode}
                        </span>
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="#94A3B8"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                        >
                          <polyline points="6 9 12 15 18 9" />
                        </svg>
                      </button>
                      {countryOpen && (
                        <div style={dropdownPanelStyle}>
                          <div style={{ padding: "0 12px 8px" }}>
                            <input
                              type="text"
                              placeholder="Cari negara..."
                              value={countryQuery}
                              onChange={(e) => setCountryQuery(e.target.value)}
                              style={{
                                width: "100%",
                                padding: "8px 12px",
                                fontSize: "13px",
                                fontFamily: "'Inter', sans-serif",
                                color: "#191C1E",
                                background: "#F7F7F8",
                                border: "1px solid rgba(204, 195, 216, 0.4)",
                                borderRadius: "6px",
                                outline: "none",
                              }}
                            />
                          </div>
                          {(() => {
                            const q = countryQuery.trim().toLowerCase()
                            const filtered = (countries ?? [])
                              .filter(
                                (c) =>
                                  !q ||
                                  c.name.toLowerCase().includes(q) ||
                                  c.code.toLowerCase().includes(q),
                              )
                              .slice(0, 5)
                            if (filtered.length === 0) {
                              return (
                                <div
                                  style={{
                                    padding: "12px 20px",
                                    fontSize: "13px",
                                    color: "#94A3B8",
                                    fontFamily: "'Inter', sans-serif",
                                    textAlign: "center",
                                  }}
                                >
                                  Tidak ada hasil
                                </div>
                              )
                            }
                            return filtered.map((c) => {
                              const active = countryCode === c.code
                              return (
                                <button
                                  key={c.code}
                                  type="button"
                                  style={dropdownItemStyle}
                                  onClick={() => {
                                    setCountryCode(c.code)
                                    setCountryQuery("")
                                    setCountryOpen(false)
                                  }}
                                >
                                  <span style={dropdownLabelStyle(active)}>
                                    {c.code} - {c.name}
                                  </span>
                                  {active && <CheckIcon />}
                                </button>
                              )
                            })
                          })()}
                        </div>
                      )}
                    </div>
                  </div>
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
                        {dialCode || "+62"}
                      </span>
                      <input
                        type="text"
                        value={phone}
                        readOnly
                        placeholder="-"
                        style={{
                          ...inputStyle,
                          height: "100%",
                          borderRadius: 0,
                          flex: 1,
                          minWidth: 0,
                          color: phone ? "#191C1E" : "#94A3B8",
                        }}
                        title="Nomor diambil dari kontak utama klien"
                      />
                    </div>
                  </div>
                  <div>
                    <label style={labelStyle}>Email</label>
                    <input
                      type="email"
                      value={email}
                      placeholder="contact@nusantara.com"
                      onChange={(e) => setEmail(e.target.value)}
                      style={inputStyle}
                    />
                  </div>
                </div>

                <div>
                  <label style={labelStyle}>NPWP</label>
                  <input
                    type="text"
                    value={npwp}
                    placeholder="00.000.000.0-000.000"
                    onChange={(e) => setNpwp(e.target.value)}
                    style={{ ...inputStyle, height: "47px", fontSize: "16px" }}
                  />
                </div>

                <div>
                  <label style={labelStyle}>Alamat Rinci</label>
                  <textarea
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    rows={3}
                    placeholder="Gedung Wisma Niaga, Lantai 12, Jl. Sudirman Kav 52-53"
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
                      Menonaktifkan akun akan segera memutuskan semua sesi aktif dan mencegah
                      pengguna masuk kembali ke sistem.
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
              disabled={!dirty || updateClient.isPending}
              style={{
                padding: "12px 28px",
                borderRadius: "12px",
                border: "none",
                background: "transparent",
                color: dirty && !updateClient.isPending ? "#630ED4" : "#CBD5E1",
                fontFamily: "'Inter', sans-serif",
                fontWeight: 700,
                fontSize: "14px",
                cursor: dirty && !updateClient.isPending ? "pointer" : "default",
              }}
            >
              Batal
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!dirty || updateClient.isPending}
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
                cursor: dirty && !updateClient.isPending ? "pointer" : "default",
                opacity: updateClient.isPending ? 0.7 : 1,
              }}
            >
              {updateClient.isPending ? "Menyimpan…" : "Simpan Perubahan"}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
