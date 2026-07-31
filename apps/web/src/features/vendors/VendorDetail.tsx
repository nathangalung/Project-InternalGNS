import { useEffect, useRef, useState } from "react"
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
import { ui } from "@/lib/ui"
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

const labelCls =
  "mb-2 block text-[10px] font-bold uppercase leading-[15px] tracking-[1px] text-[#4A4455]"

// Shared field shell; height and radius vary per use, so they stay out of here.
const inputBase =
  "w-full border-[1.5px] bg-[#F2F4F6] px-4 py-3 text-sm font-medium text-[#191C1E] outline-none transition-[border-color] duration-150"

const inputCls = `${inputBase} h-11 rounded-md border-transparent`

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
          <div className="flex flex-col gap-3">
            <nav className={ui.breadcrumb}>
              <button type="button" className={ui.breadcrumbLink} onClick={onBack}>
                Daftar Vendor
              </button>
              <span className={ui.breadcrumbSep}>&rsaquo;</span>
              <span className={ui.breadcrumbCurrent}>Detail Vendor</span>
            </nav>

            <div className="flex items-center gap-5">
              <button
                type="button"
                onClick={onBack}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-white shadow-[0px_1px_2px_rgba(0,0,0,0.05)]"
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
              <h1 className="page-title m-0">Detail Vendor</h1>
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
                  handleLogoSelect(e.target.files?.[0])
                  e.target.value = ""
                }}
              />
              <div className="relative shrink-0">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  title="Klik untuk ganti logo"
                  className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-lg p-0 text-[20px] font-extrabold tracking-[0.5px] text-white"
                  style={{ background: logoDataUrl ? "#FFFFFF" : logoBg }}
                >
                  {logoDataUrl ? (
                    <img
                      src={logoDataUrl}
                      alt="Logo vendor"
                      className="h-full w-full object-cover"
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
                  className="absolute -bottom-1 -right-1 flex h-[26px] w-[26px] items-center justify-center rounded-full border-2 border-white bg-white p-0 shadow-[0_2px_6px_rgba(0,0,0,0.15)]"
                >
                  <span className="flex h-full w-full items-center justify-center rounded-full bg-[linear-gradient(135deg,#630ED4_0%,#7C3AED_100%)]">
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
              <div className="min-w-0 flex-1">
                <h2 className="m-0 break-words text-[18px] font-bold leading-6 tracking-[-0.4px] text-[#191C1E]">
                  {vendor.name}
                </h2>
                <span className="text-[13px] font-medium leading-[18px] text-[#4A4455]">
                  Vendor
                </span>
              </div>
              <div
                className={`flex shrink-0 flex-col gap-0.5 rounded-[10px] border px-4 py-2.5 ${
                  vendor.isActive
                    ? "border-[#BBF7D0] bg-[#F0FDF4]"
                    : "border-[#FECACA] bg-[#FEF2F2]"
                }`}
              >
                <span className="text-[9px] font-semibold uppercase leading-[11px] tracking-[1.4px] text-dark-500">
                  Status
                </span>
                <span
                  className={`text-[13px] font-extrabold leading-4 tracking-[0.2px] ${
                    vendor.isActive ? "text-[#065F46]" : "text-[#991B1B]"
                  }`}
                >
                  {vendor.isActive ? "Aktif" : "Nonaktif"}
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-8 rounded-lg bg-white p-8">
              <div>
                <h3 className="m-0 text-[20px] font-bold leading-7 tracking-[-0.5px] text-[#191C1E]">
                  Informasi Utama Vendor
                </h3>
                <p className="m-0 mt-1 text-sm font-normal leading-5 text-[#4A4455]">
                  Kelola informasi vendor.
                </p>
              </div>

              <div className="flex flex-col gap-6">
                <div>
                  <label className={labelCls}>
                    Nama Vendor <span className="text-[#DC2626]">*</span>
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => {
                      setName(e.target.value)
                      setFieldErrors((p) => ({ ...p, name: "" }))
                    }}
                    className={`${inputBase} h-11 rounded-md ${
                      fieldErrors.name ? "border-[#DC2626]" : "border-transparent"
                    }`}
                  />
                  {fieldErrors.name && (
                    <div className="mt-1.5 text-xs text-[#DC2626]">{fieldErrors.name}</div>
                  )}
                </div>

                <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,13rem),1fr))] gap-6">
                  <div>
                    <label className={labelCls}>No HP</label>
                    <div className="flex h-11 overflow-hidden rounded-md">
                      <span className="flex shrink-0 items-center whitespace-nowrap bg-[#E6E8EA] px-3 text-sm font-medium text-[#4A4455]">
                        +62
                      </span>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={phone}
                        placeholder="81234567890"
                        onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
                        className={`${inputBase} h-full min-w-0 flex-1 rounded-none border-transparent`}
                      />
                    </div>
                  </div>
                  <div>
                    <label className={labelCls}>Email</label>
                    <input
                      type="email"
                      value={email}
                      placeholder="contact@vendor.com"
                      onChange={(e) => setEmail(e.target.value)}
                      className={inputCls}
                    />
                  </div>
                </div>

                <div>
                  <label className={labelCls}>Alamat Rinci</label>
                  <textarea
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    rows={3}
                    placeholder="Alamat lengkap kantor pusat atau operasional"
                    className={`${inputBase} h-auto min-h-24 resize-y rounded-md border-transparent`}
                  />
                </div>
              </div>

              <div className="border-t border-[#ECEEF0] pt-6">
                <div className="flex items-center justify-between gap-6 rounded-md bg-[#F2F4F6] px-6 py-5">
                  <div className="flex-1">
                    <div className="text-sm font-bold leading-5 text-[#191C1E]">Status Akun</div>
                    <div className="mt-1 text-xs font-normal leading-4 text-[#4A4455]">
                      Menonaktifkan vendor mencegah penggunaan dalam transaksi procurement
                      berikutnya.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsActive((a) => !a)}
                    role="switch"
                    aria-checked={isActive}
                    className={`relative h-8 w-14 shrink-0 cursor-pointer rounded-full transition-[background] duration-200 ease-[ease] ${
                      isActive ? "bg-[#630ED4]" : "bg-[#CBD5E1]"
                    }`}
                  >
                    <span
                      className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.15)] transition-[left] duration-200 ease-[ease] ${
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
              disabled={!dirty || updateVendor.isPending}
              className={`rounded-lg bg-transparent px-7 py-3 text-sm font-bold ${
                dirty && !updateVendor.isPending
                  ? "cursor-pointer text-[#630ED4]"
                  : "cursor-default text-[#CBD5E1]"
              }`}
            >
              Batal
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!dirty || updateVendor.isPending}
              className={`rounded-lg px-8 py-3 text-sm font-bold text-white ${
                dirty
                  ? "bg-[linear-gradient(135deg,#630ED4_0%,#7C3AED_100%)] shadow-[0px_10px_15px_-3px_rgba(99,14,212,0.2),0px_4px_6px_-4px_rgba(99,14,212,0.2)]"
                  : "bg-[#CBD5E1] shadow-none"
              } ${
                dirty && !updateVendor.isPending ? "cursor-pointer" : "cursor-default"
              } ${updateVendor.isPending ? "opacity-70" : "opacity-100"}`}
            >
              {updateVendor.isPending ? "Menyimpan…" : "Simpan Perubahan"}
            </button>
          </div>

          <div className="mt-2 flex flex-col gap-4">
            <h3 className="m-0 text-[20px] font-extrabold leading-7 tracking-[-0.5px] text-[#191C1E]">
              Daftar Produk Vendor
            </h3>

            <div className={ui.tableWrap}>
              <table className="w-full border-collapse">
                <thead>
                  <tr className={ui.theadRow}>
                    <th className={ui.thCenter} style={{ width: 360 }}>
                      Nama Produk
                    </th>
                    <th className={ui.thCenter} style={{ width: 200 }}>
                      Kode IMPA
                    </th>
                    <th className={ui.thCenter} style={{ width: 200 }}>
                      SKU Vendor
                    </th>
                    <th className={ui.thCenter} style={{ width: 200 }}>
                      Harga Beli
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {itemsLoading && (
                    <tr>
                      <td colSpan={4} className="py-10 text-center text-sm text-dark-500">
                        Memuat data…
                      </td>
                    </tr>
                  )}
                  {!itemsLoading && (vendorItems ?? []).length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-10 text-center text-sm text-dark-500">
                        Belum ada produk vendor.
                      </td>
                    </tr>
                  )}
                  {!itemsLoading &&
                    (vendorItems ?? []).map((item) => (
                      <tr key={item.itemId} className={ui.tr}>
                        <td className={`${ui.tdCenter} font-medium text-dark-900`}>
                          {item.itemName}
                        </td>
                        <td className={ui.tdCenter}>{item.impaCode ?? "-"}</td>
                        <td className={ui.tdCenter}>{item.vendorSku ?? "-"}</td>
                        <td className={`${ui.tdCenter} font-extrabold text-[#630ED4]`}>
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
