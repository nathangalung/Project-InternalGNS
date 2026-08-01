import { useEffect, useMemo, useRef, useState } from "react"
import { CheckIcon } from "@/components/document/icons"
import {
  dropdownItemStyle,
  dropdownLabelStyle,
  dropdownPanelStyleCompact as dropdownPanelStyle,
} from "@/components/shared/filter-styles"
import Sidebar from "@/components/shared/Sidebar"
import { TableEmptyRow, TableLoadingRow } from "@/components/shared/TableStates"
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
import { ui } from "@/lib/ui"
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

const labelCls =
  "mb-2 block text-[10px] font-bold uppercase leading-[15px] tracking-[1px] text-[#4A4455]"

const inputBase =
  "h-11 w-full rounded-md border-[1.5px] bg-[#F2F4F6] px-4 py-3 font-sans text-sm font-medium text-[#191C1E] outline-none transition-[border-color] duration-150"

const textareaCls =
  "min-h-24 w-full resize-y rounded-md border-[1.5px] border-transparent bg-[#F2F4F6] px-4 py-3 font-sans text-sm font-medium text-[#191C1E] outline-none transition-[border-color] duration-150"

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

  // Every field but the unit hydrates once from the state initializers above.
  // The unit code resolves only after the units list arrives, so seed it once
  // on arrival and never again; later refetches leave the form untouched.
  const unitHydrated = useRef(false)
  useEffect(() => {
    if (unitHydrated.current || !units) return
    unitHydrated.current = true
    setUnitCode(initialUnitCode)
    setUnitQuery(initialUnitCode)
  }, [units, initialUnitCode])

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
          <div className="flex flex-col gap-3">
            <nav className={ui.breadcrumb}>
              <button type="button" className={ui.breadcrumbLink} onClick={onBack}>
                Katalog Produk
              </button>
              <span className={ui.breadcrumbSep}>&rsaquo;</span>
              <span className={ui.breadcrumbCurrent}>Detail Produk</span>
            </nav>

            <div className="flex items-center gap-5">
              <button
                type="button"
                onClick={onBack}
                className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md bg-white shadow-sm"
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
              <h1 className="page-title">Detail Produk</h1>
            </div>
          </div>

          <div className="flex flex-col gap-5">
            <div className="flex items-center gap-5 rounded-lg bg-white px-6 py-5">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  handleImageSelect(e.target.files?.[0])
                  e.target.value = ""
                }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                title="Klik untuk ganti gambar produk"
                className="flex h-16 w-16 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg p-0 text-xl font-extrabold tracking-[0.5px] text-white"
                style={{ background: imageDataUrl ? "#FFFFFF" : logoBg }}
              >
                {imageDataUrl ? (
                  <img
                    src={imageDataUrl}
                    alt="Gambar produk"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  productInitials(product.name)
                )}
              </button>
              <div className="min-w-0 flex-1">
                <h2 className="break-words text-lg font-bold leading-6 tracking-[-0.4px] text-[#191C1E]">
                  {product.name}
                </h2>
                <span className="text-[13px] font-bold leading-[18px] tracking-[0.3px] text-primary-700">
                  {product.impaCode ? `IMPA ${product.impaCode}` : "Produk"}
                </span>
              </div>
              <div
                className={`flex flex-shrink-0 flex-col gap-0.5 rounded-[10px] border px-4 py-2.5 ${
                  product.isActive
                    ? "border-[#BBF7D0] bg-[#F0FDF4]"
                    : "border-[#FECACA] bg-[#FEF2F2]"
                }`}
              >
                <span className="text-[9px] font-semibold uppercase leading-[11px] tracking-[1.4px] text-dark-500">
                  Status
                </span>
                <span
                  className={`text-[13px] font-extrabold leading-4 tracking-[0.2px] ${
                    product.isActive ? "text-[#065F46]" : "text-[#991B1B]"
                  }`}
                >
                  {product.isActive ? "Aktif" : "Nonaktif"}
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-8 rounded-lg bg-white p-8">
              <div>
                <h3 className="text-xl font-bold leading-7 tracking-[-0.5px] text-[#191C1E]">
                  Informasi Utama Produk
                </h3>
                <p className="mt-1 text-sm font-normal leading-5 text-[#4A4455]">
                  Kelola informasi produk.
                </p>
              </div>

              <div className="flex flex-col gap-6">
                <div>
                  <label className={labelCls}>
                    Nama Produk <span className="text-[#DC2626]">*</span>
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => {
                      setName(e.target.value)
                      setFieldErrors((p) => ({ ...p, name: "" }))
                    }}
                    className={`${inputBase} ${
                      fieldErrors.name ? "border-[#DC2626]" : "border-transparent"
                    }`}
                  />
                  {fieldErrors.name && (
                    <div className="mt-1.5 text-[12px] text-[#DC2626]">{fieldErrors.name}</div>
                  )}
                </div>

                <div>
                  <label className={labelCls}>Kode IMPA</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={impa}
                    placeholder="Contoh: 330212"
                    onChange={(e) => setImpa(e.target.value.replace(/\D/g, ""))}
                    className={`${inputBase} border-transparent`}
                  />
                </div>

                <div>
                  <label className={labelCls}>Satuan Default</label>
                  <div className="relative">
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
                      className={`${inputBase} border-transparent ${unitQuery ? "pr-9" : ""}`}
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
                        className="absolute right-2.5 top-1/2 flex -translate-y-1/2 items-center p-1 text-[#94A3B8]"
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
                          <div className="px-5 py-3 text-center text-[13px] text-[#94A3B8]">
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
                  <label className={labelCls}>Deskripsi</label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={3}
                    placeholder="Deskripsi tambahan produk (opsional)"
                    className={textareaCls}
                  />
                </div>
              </div>

              <div className="border-t border-[#ECEEF0] pt-6">
                <div className="flex items-center justify-between gap-6 rounded-md bg-[#F2F4F6] px-6 py-5">
                  <div className="flex-1">
                    <div className="text-sm font-bold leading-5 text-[#191C1E]">Status Produk</div>
                    <div className="mt-1 text-caption font-normal text-[#4A4455]">
                      Menonaktifkan produk akan menyembunyikan dari katalog dan mencegah penggunaan
                      dalam quotation baru.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsActive((a) => !a)}
                    role="switch"
                    aria-checked={isActive}
                    className={`relative h-8 w-14 flex-shrink-0 rounded-full transition-colors duration-200 ${
                      isActive ? "bg-primary-700" : "bg-dark-300"
                    }`}
                  >
                    <span
                      className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.15)] transition-[left] duration-200 ${
                        isActive ? "left-7" : "left-1"
                      }`}
                    />
                  </button>
                </div>
              </div>

              {submitError && (
                <div className="rounded-md border-l-4 border-[#DC2626] bg-[#FEF2F2] px-4 py-3 text-[13px] text-[#7F1D1D]">
                  {submitError}
                </div>
              )}
            </div>
          </div>

          <div className="mt-2 flex justify-end gap-4">
            <button
              type="button"
              onClick={handleCancel}
              disabled={!dirty || updateItem.isPending}
              className={`rounded-lg px-7 py-3 text-sm font-bold ${
                dirty && !updateItem.isPending
                  ? "cursor-pointer text-primary-700"
                  : "cursor-default text-[#CBD5E1]"
              }`}
            >
              Batal
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!dirty || updateItem.isPending}
              className={`rounded-lg px-8 py-3 text-sm font-bold text-white ${
                dirty
                  ? "bg-[linear-gradient(135deg,#630ED4_0%,#7C3AED_100%)] shadow-[0px_10px_15px_-3px_rgba(99,14,212,0.2),0px_4px_6px_-4px_rgba(99,14,212,0.2)]"
                  : "bg-[#CBD5E1]"
              } ${dirty && !updateItem.isPending ? "cursor-pointer" : "cursor-default"} ${
                updateItem.isPending ? "opacity-70" : "opacity-100"
              }`}
            >
              {updateItem.isPending ? "Menyimpan…" : "Simpan Perubahan"}
            </button>
          </div>

          <div className="mt-2 flex flex-col gap-6 rounded-lg bg-white p-8">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <h3 className="text-xl font-extrabold leading-7 tracking-[-0.5px] text-[#191C1E]">
                  Daftar Vendor Terkait
                </h3>
                <span className="inline-flex items-center rounded-full bg-[rgba(99,14,212,0.08)] px-2.5 py-[3px] text-[11px] font-bold tracking-[0.2px] text-primary-700">
                  {(itemVendors ?? []).length}
                </span>
              </div>
              <button
                type="button"
                className={`${ui.btnPrimary} w-[200px]`}
                onClick={() => setShowAddVendor(true)}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                >
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                Tambah Vendor
              </button>
            </div>

            <table className="w-full border-collapse">
              <thead>
                <tr className={ui.theadRow}>
                  <th className={ui.thCenter} style={{ width: 280 }}>
                    Nama Vendor
                  </th>
                  <th className={ui.thCenter} style={{ width: 200 }}>
                    SKU Vendor
                  </th>
                  <th className={ui.thCenter} style={{ width: 180 }}>
                    Harga Beli
                  </th>
                  <th className={ui.thCenter} style={{ width: 200 }}>
                    Penawaran Terakhir
                  </th>
                </tr>
              </thead>
              <tbody>
                {vendorsLoading && <TableLoadingRow colSpan={4} />}
                {!vendorsLoading && (itemVendors ?? []).length === 0 && (
                  <TableEmptyRow colSpan={4}>
                    Belum ada vendor terkait. Klik "Tambah Vendor" untuk menambah.
                  </TableEmptyRow>
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
                      <tr key={v.vendorProductId} className={ui.tr}>
                        <td className={ui.td}>
                          <div className="flex items-center gap-3 pl-4">
                            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-dark-100 text-[13px] font-bold text-primary-700">
                              {initials || "?"}
                            </div>
                            <span className="text-sm font-medium text-[#191C1E]">
                              {v.vendorName}
                            </span>
                          </div>
                        </td>
                        <td className={`${ui.tdCenter} font-medium`}>{v.vendorSku ?? "-"}</td>
                        <td className={`${ui.tdCenter} font-bold text-[#191C1E]`}>
                          {formattedPrice}
                        </td>
                        <td className={`${ui.tdCenter} font-medium`}>{formattedDate}</td>
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
