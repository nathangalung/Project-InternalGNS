import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react"
import { CheckIcon } from "@/components/document/icons"
import {
  dropdownItemStyle,
  dropdownLabelStyle,
  dropdownPanelStyleCompact as dropdownPanelStyle,
} from "@/components/shared/filter-styles"
import Sidebar from "@/components/shared/Sidebar"
import AddVendorToItemModal from "@/features/items/AddVendorToItemModal"
import {
  useItemImageDownloadUrl,
  useItemVendors,
  useUpdateItem,
  useUploadItemImage,
} from "@/features/items/hooks"
import { useUnits } from "@/features/units/hooks"
import { ApiError, fetchObjectUrl } from "@/lib/api-client"
import { logoBackground } from "@/lib/avatar"
import { formatRupiah } from "@/lib/format"
import type { Page } from "@/lib/page"
import type { ItemRow } from "@/types/api"

interface ProductDetailProps {
  product: ItemRow
  onNavigate: (page: Page) => void
  onBack: () => void
  onLogout: () => void
}

function productInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "?"
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
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

export default function ProductDetail({
  product,
  onNavigate,
  onBack,
  onLogout,
}: ProductDetailProps) {
  const { data: units } = useUnits()

  const initialUnitCode = useMemo(() => {
    if (product.defaultUnitId === undefined) return ""
    return units?.find((u) => u.id === product.defaultUnitId)?.code ?? ""
  }, [units, product.defaultUnitId])

  const [name, setName] = useState(product.name)
  const [impa, setImpa] = useState(product.impaCode ?? "")
  const [unitCode, setUnitCode] = useState<string>(initialUnitCode)
  const [unitQuery, setUnitQuery] = useState<string>(initialUnitCode)
  const [showUnitSuggestions, setShowUnitSuggestions] = useState(false)
  const [description, setDescription] = useState(product.description ?? "")
  const [isActive, setIsActive] = useState(product.isActive)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [showAddVendor, setShowAddVendor] = useState(false)
  const [imageDataUrl, setImageDataUrl] = useState<string>("")
  const fileInputRef = useRef<HTMLInputElement>(null)

  const updateItem = useUpdateItem()
  const uploadImage = useUploadItemImage()
  const { data: imageDownload } = useItemImageDownloadUrl(product.id, product.imageObjectKey)
  const { data: itemVendors, isLoading: vendorsLoading } = useItemVendors(product.id)

  useEffect(() => {
    const path = imageDownload?.downloadUrl
    if (!path) {
      if (!product.imageObjectKey) setImageDataUrl("")
      return
    }
    let active = true
    let objectUrl = ""
    fetchObjectUrl(path)
      .then((u) => {
        if (active) {
          objectUrl = u
          setImageDataUrl(u)
        } else {
          URL.revokeObjectURL(u)
        }
      })
      .catch(() => {})
    return () => {
      active = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [imageDownload?.downloadUrl, product.imageObjectKey])

  function handleImageSelect(file: File | undefined) {
    if (!file) return
    if (!file.type.startsWith("image/")) return
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === "string") setImageDataUrl(reader.result)
    }
    reader.readAsDataURL(file)
    uploadImage.mutate({ id: product.id, file })
  }

  useEffect(() => {
    setName(product.name)
    setImpa(product.impaCode ?? "")
    const code =
      product.defaultUnitId !== undefined
        ? (units?.find((u) => u.id === product.defaultUnitId)?.code ?? "")
        : ""
    setUnitCode(code)
    setUnitQuery(code)
    setDescription(product.description ?? "")
    setIsActive(product.isActive)
  }, [
    product.name,
    product.impaCode,
    product.defaultUnitId,
    product.description,
    product.isActive,
    units,
  ])

  const dirty =
    name !== product.name ||
    impa !== (product.impaCode ?? "") ||
    unitCode !== initialUnitCode ||
    description !== (product.description ?? "") ||
    isActive !== product.isActive

  const filteredUnits = useMemo(() => {
    const q = unitQuery.trim().toLowerCase()
    if (!q) return []
    return (units ?? [])
      .filter((u) => u.code.toLowerCase().includes(q) || (u.name ?? "").toLowerCase().includes(q))
      .slice(0, 5)
  }, [units, unitQuery])

  const logoBg = logoBackground(product.name)

  const handleCancel = () => {
    setName(product.name)
    setImpa(product.impaCode ?? "")
    setUnitCode(initialUnitCode)
    setUnitQuery(initialUnitCode)
    setDescription(product.description ?? "")
    setIsActive(product.isActive)
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
    const unit = units?.find((u) => u.code === unitCode)
    try {
      await updateItem.mutateAsync({
        id: product.id,
        input: {
          name: name.trim(),
          impaCode: impa.trim() || undefined,
          defaultUnitId: unit?.id,
          description: description.trim() || undefined,
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
      <Sidebar activePage={"products" as Page} onNavigate={onNavigate} onLogout={onLogout} />

      <div className="admin-main">
        <div className="page-content" style={{ gap: "29px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <nav className="qd-breadcrumb">
              <button className="qd-breadcrumb-link" onClick={onBack}>
                Katalog Produk
              </button>
              <span className="qd-breadcrumb-sep">&rsaquo;</span>
              <span className="qd-breadcrumb-current">Detail Produk</span>
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
                Detail Produk
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
                  handleImageSelect(e.target.files?.[0])
                  e.target.value = ""
                }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                title="Klik untuk ganti gambar produk"
                style={{
                  width: "64px",
                  height: "64px",
                  borderRadius: "12px",
                  background: imageDataUrl ? "#FFFFFF" : logoBg,
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
                  flexShrink: 0,
                }}
              >
                {imageDataUrl ? (
                  <img
                    src={imageDataUrl}
                    alt="Gambar produk"
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  />
                ) : (
                  productInitials(product.name)
                )}
              </button>
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
                  {product.name}
                </h2>
                <span
                  style={{
                    fontFamily: "'Inter', sans-serif",
                    fontWeight: 700,
                    fontSize: "13px",
                    lineHeight: "18px",
                    color: "#630ED4",
                    letterSpacing: "0.3px",
                  }}
                >
                  {product.impaCode ? `IMPA ${product.impaCode}` : "Produk"}
                </span>
              </div>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "2px",
                  padding: "10px 16px",
                  background: product.isActive ? "#F0FDF4" : "#FEF2F2",
                  border: `1px solid ${product.isActive ? "#BBF7D0" : "#FECACA"}`,
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
                    color: product.isActive ? "#065F46" : "#991B1B",
                    lineHeight: "16px",
                  }}
                >
                  {product.isActive ? "Aktif" : "Nonaktif"}
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
                  Informasi Utama Produk
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
                  Kelola informasi produk.
                </p>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
                <div>
                  <label style={labelStyle}>
                    Nama Produk <span style={{ color: "#DC2626" }}>*</span>
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

                <div>
                  <label style={labelStyle}>Kode IMPA</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={impa}
                    placeholder="Contoh: 330212"
                    onChange={(e) => setImpa(e.target.value.replace(/\D/g, ""))}
                    style={inputStyle}
                  />
                </div>

                <div>
                  <label style={labelStyle}>Satuan Default</label>
                  <div style={{ position: "relative" }}>
                    <input
                      type="text"
                      placeholder="Ketik nama satuan..."
                      value={unitQuery}
                      onChange={(e) => {
                        setUnitQuery(e.target.value)
                        setShowUnitSuggestions(true)
                        if (unitCode) setUnitCode("")
                      }}
                      onFocus={() => {
                        if (unitQuery.length > 0 && !unitCode) setShowUnitSuggestions(true)
                      }}
                      style={{ ...inputStyle, paddingRight: unitQuery ? "36px" : undefined }}
                    />
                    {unitQuery && (
                      <button
                        type="button"
                        onClick={() => {
                          setUnitQuery("")
                          setUnitCode("")
                          setShowUnitSuggestions(false)
                        }}
                        title="Bersihkan"
                        style={{
                          position: "absolute",
                          right: "10px",
                          top: "50%",
                          transform: "translateY(-50%)",
                          background: "transparent",
                          border: "none",
                          cursor: "pointer",
                          padding: "4px",
                          display: "flex",
                          alignItems: "center",
                          color: "#94A3B8",
                        }}
                      >
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
                    )}
                    {showUnitSuggestions && unitQuery.length > 0 && (
                      <div style={dropdownPanelStyle}>
                        {filteredUnits.length === 0 ? (
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
                        ) : (
                          filteredUnits.map((u) => {
                            const active = unitCode === u.code
                            const label = u.name ? `${u.code} — ${u.name}` : u.code
                            return (
                              <button
                                key={u.id}
                                type="button"
                                style={dropdownItemStyle}
                                onClick={() => {
                                  setUnitCode(u.code)
                                  setUnitQuery(u.code)
                                  setShowUnitSuggestions(false)
                                }}
                              >
                                <span style={dropdownLabelStyle(active)}>{label}</span>
                                {active && <CheckIcon />}
                              </button>
                            )
                          })
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <label style={labelStyle}>Deskripsi</label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={3}
                    placeholder="Deskripsi tambahan produk (opsional)"
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
                      Status Produk
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
                      Menonaktifkan produk akan menyembunyikan dari katalog dan mencegah penggunaan
                      dalam quotation baru.
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
              disabled={!dirty || updateItem.isPending}
              style={{
                padding: "12px 28px",
                borderRadius: "12px",
                border: "none",
                background: "transparent",
                color: dirty && !updateItem.isPending ? "#630ED4" : "#CBD5E1",
                fontFamily: "'Inter', sans-serif",
                fontWeight: 700,
                fontSize: "14px",
                cursor: dirty && !updateItem.isPending ? "pointer" : "default",
              }}
            >
              Batal
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!dirty || updateItem.isPending}
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
                cursor: dirty && !updateItem.isPending ? "pointer" : "default",
                opacity: updateItem.isPending ? 0.7 : 1,
              }}
            >
              {updateItem.isPending ? "Menyimpan…" : "Simpan Perubahan"}
            </button>
          </div>

          <div
            style={{
              background: "#FFFFFF",
              borderRadius: "12px",
              padding: "32px",
              display: "flex",
              flexDirection: "column",
              gap: "24px",
              marginTop: "8px",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "16px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
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
                  Daftar Vendor Terkait
                </h3>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    padding: "3px 10px",
                    borderRadius: 999,
                    background: "rgba(99, 14, 212, 0.08)",
                    color: "#630ED4",
                    fontFamily: "'Inter', sans-serif",
                    fontWeight: 700,
                    fontSize: "11px",
                    letterSpacing: "0.2px",
                  }}
                >
                  {(itemVendors ?? []).length}
                </span>
              </div>
              <button
                type="button"
                className="btn-admin-primary"
                onClick={() => setShowAddVendor(true)}
                style={{ width: "200px", justifyContent: "center" }}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="#fff"
                  stroke="#fff"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                >
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                Tambah Vendor
              </button>
            </div>

            <table className="tbl">
              <thead>
                <tr className="tbl-header-row">
                  <th className="tbl-th tbl-th--center" style={{ width: 280 }}>
                    Nama Vendor
                  </th>
                  <th className="tbl-th tbl-th--center" style={{ width: 200 }}>
                    SKU Vendor
                  </th>
                  <th className="tbl-th tbl-th--center" style={{ width: 180 }}>
                    Harga Beli
                  </th>
                  <th className="tbl-th tbl-th--center" style={{ width: 200 }}>
                    Penawaran Terakhir
                  </th>
                </tr>
              </thead>
              <tbody>
                {vendorsLoading && (
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
                {!vendorsLoading && (itemVendors ?? []).length === 0 && (
                  <tr>
                    <td
                      colSpan={4}
                      className="tbl-td tbl-td--center"
                      style={{ padding: "40px 0", color: "#64748B" }}
                    >
                      Belum ada vendor terkait. Klik "Tambah Vendor" untuk menambah.
                    </td>
                  </tr>
                )}
                {!vendorsLoading &&
                  (itemVendors ?? []).map((v) => {
                    const initials = v.vendorName
                      .replace(/^PT\.?\s+/i, "")
                      .trim()
                      .split(/\s+/)
                      .filter(Boolean)
                      .slice(0, 2)
                      .map((p) => p[0])
                      .join("")
                      .toUpperCase()
                    const formattedPrice = formatRupiah(v.costPrice, "-")
                    const formattedDate = v.lastQuotedAt
                      ? new Date(v.lastQuotedAt).toLocaleDateString("id-ID", {
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                        })
                      : "-"
                    return (
                      <tr key={v.vendorProductId} className="tbl-row">
                        <td className="tbl-td">
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "12px",
                              paddingLeft: "16px",
                            }}
                          >
                            <div
                              style={{
                                width: "32px",
                                height: "32px",
                                borderRadius: "8px",
                                background: "#F1F5F9",
                                color: "#630ED4",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                fontFamily: "'Inter', sans-serif",
                                fontWeight: 700,
                                fontSize: "13px",
                                flexShrink: 0,
                              }}
                            >
                              {initials || "?"}
                            </div>
                            <span
                              style={{
                                fontFamily: "'Inter', sans-serif",
                                fontWeight: 500,
                                fontSize: "14px",
                                color: "#191C1E",
                              }}
                            >
                              {v.vendorName}
                            </span>
                          </div>
                        </td>
                        <td
                          className="tbl-td tbl-td--center"
                          style={{ color: "#4A4455", fontWeight: 500 }}
                        >
                          {v.vendorSku ?? "-"}
                        </td>
                        <td
                          className="tbl-td tbl-td--center"
                          style={{ fontWeight: 700, color: "#191C1E" }}
                        >
                          {formattedPrice}
                        </td>
                        <td
                          className="tbl-td tbl-td--center"
                          style={{ color: "#4A4455", fontWeight: 500 }}
                        >
                          {formattedDate}
                        </td>
                      </tr>
                    )
                  })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <AddVendorToItemModal
        open={showAddVendor}
        itemId={product.id}
        onOpenChange={setShowAddVendor}
      />
    </div>
  )
}
