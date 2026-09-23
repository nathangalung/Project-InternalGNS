import { useEffect, useId, useRef, useState } from "react"
import EntityLink from "@/components/shared/EntityLink"
import { TableEmptyRow, TableLoadingRow } from "@/components/shared/TableStates"
import { useMe } from "@/features/auth/hooks"
import { VENDOR_ITEMS_LIMIT } from "@/features/vendors/api"
import {
  useUpdateVendor,
  useUploadVendorLogo,
  useVendorItems,
  useVendorLogoDownloadUrl,
} from "@/features/vendors/hooks"
import { ApiError, fetchObjectUrl } from "@/lib/api-client"
import { logoBackground } from "@/lib/avatar"
import { errorMessage } from "@/lib/errors"
import { formatRupiah } from "@/lib/format"
import { canWriteCatalog } from "@/lib/rbac"
import { toast } from "@/lib/toast"
import { ui } from "@/lib/ui"
import { validateAsset } from "@/lib/upload-validation"
import type { VendorContactInfo, VendorRow } from "@/types/api"
import { buildContactInfo } from "./contact-info"
import { vendorItemsSummary } from "./helpers"

type VendorDetailProps = {
  vendor: VendorRow
  onBack: () => void
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
const inputBase = `w-full border-[1.5px] bg-[#F2F4F6] px-4 py-3 text-sm font-medium text-[#191C1E] outline-none transition-[border-color] duration-150 ${ui.fieldFocus}`

const inputCls = `${inputBase} h-11 rounded-md border-transparent`

const logoBoxCls =
  "flex h-16 w-16 items-center justify-center overflow-hidden rounded-lg p-0 text-[20px] font-extrabold tracking-[0.5px] text-white"

export default function VendorDetail({ vendor, onBack }: VendorDetailProps) {
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

  const nameId = useId()
  const nameErrorId = useId()
  const phoneId = useId()
  const emailId = useId()
  const addressId = useId()
  const statusLabelId = useId()
  const statusHintId = useId()

  const { data: me } = useMe()
  const canWrite = canWriteCatalog(me?.role)

  const updateVendor = useUpdateVendor()
  const uploadLogo = useUploadVendorLogo()
  const { data: logoDownload } = useVendorLogoDownloadUrl(vendor.id, vendor.logoObjectKey)
  const {
    data: vendorItems,
    isLoading: itemsLoading,
    isError: itemsError,
  } = useVendorItems(vendor.id)
  const items = vendorItems ?? []
  const itemsSummary = vendorItemsSummary(items.length, VENDOR_ITEMS_LIMIT)

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

  // Form state hydrates once from the state initializers above. The route
  // remounts on a different vendor, so a background refetch of the same vendor
  // never overwrites in-progress edits.

  const dirty =
    name !== vendor.name ||
    phone !== initialPhone ||
    email !== initialEmail ||
    address !== (vendor.location ?? "") ||
    isActive !== vendor.isActive

  const logoBg = logoBackground(vendor.name)

  // Validate first, revert on failure.
  function handleLogoSelect(file: File | undefined) {
    if (!file) return
    try {
      validateAsset("vendorLogo", file)
    } catch (err) {
      toast.error(errorMessage(err, "Berkas logo vendor tidak valid."))
      return
    }
    const previous = logoDataUrl
    let failed = false
    const reader = new FileReader()
    reader.onload = () => {
      if (!failed && typeof reader.result === "string") setLogoDataUrl(reader.result)
    }
    reader.readAsDataURL(file)
    uploadLogo.mutate(
      { id: vendor.id, file },
      {
        onError: () => {
          failed = true
          setLogoDataUrl(previous)
        },
      },
    )
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
    try {
      await updateVendor.mutateAsync({
        id: vendor.id,
        input: {
          name: name.trim(),
          location: address.trim() || undefined,
          contactInfo: buildContactInfo(vendor.contactInfo, email, phone),
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

  const logoContent = logoDataUrl ? (
    <img src={logoDataUrl} alt="Logo vendor" className="h-full w-full object-cover" />
  ) : (
    vendorInitials(vendor.name)
  )

  return (
    <div className={ui.pageContent}>
      <div className="flex flex-col gap-3">
        <nav aria-label="Breadcrumb" className={ui.breadcrumb}>
          <button type="button" className={ui.breadcrumbLink} onClick={onBack}>
            Daftar Vendor
          </button>
          <span className={ui.breadcrumbSep} aria-hidden="true">
            &rsaquo;
          </span>
          <span className={ui.breadcrumbCurrent} aria-current="page">
            Detail Vendor
          </span>
        </nav>

        <div className="flex items-center gap-5">
          <button
            type="button"
            onClick={onBack}
            aria-label="Kembali ke Daftar Vendor"
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-white shadow-[0px_1px_2px_rgba(0,0,0,0.05)] ${ui.focusRing}`}
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
              aria-hidden="true"
            >
              <line x1="19" y1="12" x2="5" y2="12" />
              <polyline points="12 19 5 12 12 5" />
            </svg>
          </button>
          <h1 className={ui.pageTitle}>Detail Vendor</h1>
        </div>
      </div>

      <div className="flex flex-col gap-5">
        <div className="flex items-center gap-5 rounded-lg bg-white px-6 py-5">
          {canWrite ? (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                tabIndex={-1}
                aria-hidden="true"
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
                  aria-label="Ganti logo vendor"
                  className={`${logoBoxCls} ${ui.focusRing}`}
                  // Runtime colour, hashed per name
                  style={{ background: logoDataUrl ? "#FFFFFF" : logoBg }}
                >
                  {logoContent}
                </button>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  title="Ganti logo"
                  tabIndex={-1}
                  aria-hidden="true"
                  className="absolute -bottom-1 -right-1 flex h-[26px] w-[26px] items-center justify-center rounded-full border-2 border-white bg-white p-0 shadow-[0_2px_6px_rgba(0,0,0,0.15)]"
                >
                  <span className="flex h-full w-full items-center justify-center rounded-full bg-[linear-gradient(135deg,var(--color-primary-700)_0%,var(--color-primary-600)_100%)]">
                    <svg
                      aria-hidden="true"
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
            </>
          ) : (
            <div
              className={`${logoBoxCls} shrink-0`}
              // Runtime colour, hashed per name
              style={{ background: logoDataUrl ? "#FFFFFF" : logoBg }}
            >
              {logoContent}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <h2 className="m-0 break-words text-[18px] font-bold leading-6 tracking-[-0.4px] text-[#191C1E]">
              {vendor.name}
            </h2>
            <span className="text-[13px] font-medium leading-[18px] text-[#4A4455]">Vendor</span>
          </div>
          <div
            className={`flex shrink-0 flex-col gap-0.5 rounded-[10px] border px-4 py-2.5 ${
              vendor.isActive ? "border-[#BBF7D0] bg-[#F0FDF4]" : "border-[#FECACA] bg-[#FEF2F2]"
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
              {canWrite ? "Kelola informasi vendor." : "Informasi vendor, hanya dapat dilihat."}
            </p>
          </div>

          <div className="flex flex-col gap-6">
            <div>
              <label htmlFor={nameId} className={labelCls}>
                Nama Vendor{" "}
                {canWrite && (
                  <span className="text-[#DC2626]" aria-hidden="true">
                    *
                  </span>
                )}
              </label>
              <input
                id={nameId}
                type="text"
                value={name}
                required
                readOnly={!canWrite}
                aria-invalid={fieldErrors.name ? true : undefined}
                aria-describedby={fieldErrors.name ? nameErrorId : undefined}
                onChange={(e) => {
                  setName(e.target.value)
                  setFieldErrors((p) => ({ ...p, name: "" }))
                }}
                className={`${inputBase} h-11 rounded-md ${
                  fieldErrors.name ? "border-[#DC2626]" : "border-transparent"
                }`}
              />
              {fieldErrors.name && (
                <div id={nameErrorId} className="mt-1.5 text-xs text-[#DC2626]">
                  {fieldErrors.name}
                </div>
              )}
            </div>

            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,13rem),1fr))] gap-6">
              <div>
                <label htmlFor={phoneId} className={labelCls}>
                  No HP
                </label>
                <div className="flex h-11 overflow-hidden rounded-md">
                  <span className="flex shrink-0 items-center whitespace-nowrap bg-[#E6E8EA] px-3 text-sm font-medium text-[#4A4455]">
                    +62
                  </span>
                  <input
                    id={phoneId}
                    type="text"
                    inputMode="numeric"
                    value={phone}
                    placeholder={canWrite ? "81234567890" : "-"}
                    readOnly={!canWrite}
                    onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
                    className={`${inputBase} h-full min-w-0 flex-1 rounded-none border-transparent`}
                  />
                </div>
              </div>
              <div>
                <label htmlFor={emailId} className={labelCls}>
                  Email
                </label>
                <input
                  id={emailId}
                  type="email"
                  value={email}
                  placeholder={canWrite ? "contact@vendor.com" : "-"}
                  readOnly={!canWrite}
                  onChange={(e) => setEmail(e.target.value)}
                  className={inputCls}
                />
              </div>
            </div>

            <div>
              <label htmlFor={addressId} className={labelCls}>
                Alamat Rinci
              </label>
              <textarea
                id={addressId}
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                rows={3}
                readOnly={!canWrite}
                placeholder={canWrite ? "Alamat lengkap kantor pusat atau operasional" : "-"}
                className={`${inputBase} h-auto min-h-24 resize-y rounded-md border-transparent`}
              />
            </div>
          </div>

          <div className="border-t border-[#ECEEF0] pt-6">
            <div className="flex items-center justify-between gap-6 rounded-md bg-[#F2F4F6] px-6 py-5">
              <div className="flex-1">
                <div id={statusLabelId} className="text-sm font-bold leading-5 text-[#191C1E]">
                  Status Akun
                </div>
                <div
                  id={statusHintId}
                  className="mt-1 text-xs font-normal leading-4 text-[#4A4455]"
                >
                  Menonaktifkan vendor mencegah penggunaan dalam transaksi procurement berikutnya.
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsActive((a) => !a)}
                role="switch"
                aria-checked={isActive}
                aria-labelledby={statusLabelId}
                aria-describedby={statusHintId}
                disabled={!canWrite}
                className={`relative h-8 w-14 shrink-0 cursor-pointer rounded-full transition-[background] duration-200 ease-[ease] motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-60 ${ui.focusRing} ${
                  isActive ? "bg-primary-700" : "bg-dark-300"
                }`}
              >
                <span
                  className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.15)] transition-[left] duration-200 ease-[ease] motion-reduce:transition-none ${
                    isActive ? "left-7" : "left-1"
                  }`}
                />
              </button>
            </div>
          </div>

          {submitError && (
            <div
              role="alert"
              className="rounded-md border-l-4 border-[#DC2626] bg-[#FEF2F2] px-4 py-3 text-[13px] text-[#7F1D1D]"
            >
              {submitError}
            </div>
          )}
        </div>
      </div>

      {canWrite && (
        <div className="flex justify-end gap-4">
          <button
            type="button"
            onClick={handleCancel}
            disabled={!dirty || updateVendor.isPending}
            className={`rounded-lg bg-transparent px-7 py-3 text-sm font-bold ${ui.focusRing} ${
              dirty && !updateVendor.isPending
                ? "cursor-pointer text-primary-700"
                : "cursor-default text-dark-300"
            }`}
          >
            Batal
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!dirty || updateVendor.isPending}
            className={`rounded-lg px-8 py-3 text-sm font-bold text-white ${ui.focusRing} ${
              dirty
                ? "bg-[linear-gradient(135deg,var(--color-primary-700)_0%,var(--color-primary-600)_100%)] shadow-[0px_10px_15px_-3px_rgba(99,14,212,0.2),0px_4px_6px_-4px_rgba(99,14,212,0.2)]"
                : "bg-dark-300 shadow-none"
            } ${
              dirty && !updateVendor.isPending ? "cursor-pointer" : "cursor-default"
            } ${updateVendor.isPending ? "opacity-70" : "opacity-100"}`}
          >
            {updateVendor.isPending ? "Menyimpan…" : "Simpan Perubahan"}
          </button>
        </div>
      )}

      <div className="flex flex-col gap-4">
        <h3 className="m-0 text-[20px] font-extrabold leading-7 tracking-[-0.5px] text-[#191C1E]">
          Daftar Produk Vendor
          {!itemsLoading && !itemsError && (
            <span className="ml-2 text-base font-semibold text-dark-500">
              ({itemsSummary.count})
            </span>
          )}
        </h3>

        <div className={ui.tableWrap}>
          <table className="w-full border-collapse">
            <thead>
              <tr className={ui.theadRow}>
                <th className={`${ui.thCenter} w-[360px]`}>Nama Produk</th>
                <th className={`${ui.thCenter} w-[200px]`}>Kode IMPA</th>
                <th className={`${ui.thCenter} w-[200px]`}>SKU Vendor</th>
                <th className={`${ui.thCenter} w-[200px]`}>Harga Beli</th>
              </tr>
            </thead>
            <tbody>
              {itemsLoading && <TableLoadingRow colSpan={4} />}
              {!itemsLoading && itemsError && (
                <TableEmptyRow colSpan={4}>Gagal memuat produk vendor.</TableEmptyRow>
              )}
              {!itemsLoading && !itemsError && items.length === 0 && (
                <TableEmptyRow colSpan={4}>Belum ada produk vendor.</TableEmptyRow>
              )}
              {!itemsLoading &&
                items.map((item) => (
                  <tr key={item.itemId} className={ui.tr}>
                    <td className={`${ui.tdCenter} font-medium text-dark-900`}>
                      <EntityLink kind="product" id={item.itemId} tone="name">
                        {item.itemName}
                      </EntityLink>
                    </td>
                    <td className={ui.tdCenter}>{item.impaCode ?? "-"}</td>
                    <td className={ui.tdCenter}>{item.vendorSku ?? "-"}</td>
                    <td className={`${ui.tdCenter} font-extrabold text-primary-700`}>
                      {formatRupiah(item.costPrice, "-")}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        {!itemsLoading && itemsSummary.notice && (
          <p className="m-0 text-xs text-dark-500">{itemsSummary.notice}</p>
        )}
      </div>
    </div>
  )
}
