import { useEffect, useId, useMemo, useRef, useState } from "react"
import EntityLink from "@/components/shared/EntityLink"
import { TableEmptyRow, TableLoadingRow } from "@/components/shared/TableStates"
import { useMe } from "@/features/auth/hooks"
import AddVendorToItemModal from "@/features/items/AddVendorToItemModal"
import { apiFieldError, vendorInitials } from "@/features/items/helpers"
import { useItemVendors, useUpdateItem } from "@/features/items/hooks"
import ProductPhoto from "@/features/items/ProductPhoto"
import { useUnits } from "@/features/units/hooks"
import UnitCombobox from "@/features/units/UnitCombobox"
import { errorMessage } from "@/lib/errors"
import { formatDate, formatRupiah } from "@/lib/format"
import { canWriteCatalog } from "@/lib/rbac"
import { ui } from "@/lib/ui"
import type { ItemRow } from "@/types/api"

type ProductDetailProps = {
  product: ItemRow
  onBack: () => void
}

const labelCls =
  "mb-2 block text-[10px] font-bold uppercase leading-[15px] tracking-[1px] text-[#4A4455]"

const inputBase = `h-11 w-full rounded-md border-[1.5px] bg-[#F2F4F6] px-4 py-3 font-sans text-sm font-medium text-[#191C1E] outline-none transition-[border-color] duration-150 read-only:cursor-default ${ui.fieldFocus}`

const textareaCls = `min-h-24 w-full resize-y rounded-md border-[1.5px] border-transparent bg-[#F2F4F6] px-4 py-3 font-sans text-sm font-medium text-[#191C1E] outline-none transition-[border-color] duration-150 read-only:resize-none read-only:cursor-default ${ui.fieldFocus}`

export default function ProductDetail({ product, onBack }: ProductDetailProps) {
  const { data: units } = useUnits()
  const { data: me } = useMe()
  const canWrite = canWriteCatalog(me?.role)
  const nameId = useId()
  const nameErrorId = useId()
  const impaId = useId()
  const unitId = useId()
  const descriptionId = useId()
  const statusLabelId = useId()
  const statusHintId = useId()

  const initialUnitCode = useMemo(() => {
    if (product.defaultUnitId === undefined) return ""
    return units?.find((u) => u.id === product.defaultUnitId)?.code ?? ""
  }, [units, product.defaultUnitId])

  const [name, setName] = useState(product.name)
  const [impa, setImpa] = useState(product.impaCode ?? "")
  const [unitCode, setUnitCode] = useState<string>(initialUnitCode)
  const [unitQuery, setUnitQuery] = useState<string>(initialUnitCode)
  const [description, setDescription] = useState(product.description ?? "")
  const [isActive, setIsActive] = useState(product.isActive)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [showAddVendor, setShowAddVendor] = useState(false)

  const updateItem = useUpdateItem()
  const { data: itemVendors, isLoading: vendorsLoading } = useItemVendors(product.id)

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
    if (!name.trim()) errs.name = "Nama produk wajib diisi."
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
      const nameError = apiFieldError(err, "name")
      if (nameError) setFieldErrors((p) => ({ ...p, name: nameError }))
      setSubmitError(errorMessage(err, "Gagal menyimpan perubahan."))
    }
  }

  return (
    <>
      <div className={ui.pageContent}>
        <div className="flex flex-col gap-3">
          <nav className={ui.breadcrumb} aria-label="Breadcrumb">
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
              aria-label="Kembali ke Katalog Produk"
              className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md bg-white shadow-sm ${ui.focusRing}`}
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
            <h1 className={ui.pageTitle}>Detail Produk</h1>
          </div>
        </div>

        <div className="flex flex-col gap-5">
          <div className="flex items-center gap-5 rounded-lg bg-white px-6 py-5 max-sm:flex-wrap max-sm:gap-4 max-sm:px-5">
            <ProductPhoto product={product} canWrite={canWrite}>
              <h2 className="break-words text-lg font-bold leading-6 tracking-[-0.4px] text-[#191C1E]">
                {product.name}
              </h2>
              <span className="text-[13px] font-bold leading-[18px] tracking-[0.3px] text-primary-700">
                {product.impaCode ? `IMPA ${product.impaCode}` : "Produk"}
              </span>
            </ProductPhoto>
            <div
              className={`flex flex-shrink-0 flex-col gap-0.5 rounded-[10px] border px-4 py-2.5 ${
                product.isActive ? "border-[#BBF7D0] bg-[#F0FDF4]" : "border-[#FECACA] bg-[#FEF2F2]"
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

          <div className="flex flex-col gap-8 rounded-lg bg-white p-8 max-sm:p-5">
            <div>
              <h3 className="text-xl font-bold leading-7 tracking-[-0.5px] text-[#191C1E]">
                Informasi Utama Produk
              </h3>
              <p className="mt-1 text-sm font-normal leading-5 text-[#4A4455]">
                {canWrite
                  ? "Kelola informasi produk."
                  : "Peran Keuangan hanya dapat melihat data produk."}
              </p>
            </div>

            <div className="flex flex-col gap-6">
              <div>
                <label htmlFor={nameId} className={labelCls}>
                  Nama Produk {canWrite && <span className="text-[#DC2626]">*</span>}
                </label>
                <input
                  id={nameId}
                  type="text"
                  readOnly={!canWrite}
                  aria-invalid={fieldErrors.name ? true : undefined}
                  aria-describedby={fieldErrors.name ? nameErrorId : undefined}
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
                  <div id={nameErrorId} className="mt-1.5 text-[12px] text-[#DC2626]">
                    {fieldErrors.name}
                  </div>
                )}
              </div>

              <div>
                <label htmlFor={impaId} className={labelCls}>
                  Kode IMPA
                </label>
                <input
                  id={impaId}
                  type="text"
                  readOnly={!canWrite}
                  inputMode="numeric"
                  value={impa}
                  placeholder="Contoh: 330212"
                  onChange={(e) => setImpa(e.target.value.replace(/\D/g, ""))}
                  className={`${inputBase} border-transparent`}
                />
              </div>

              <div>
                <label htmlFor={unitId} className={labelCls}>
                  Satuan Default
                </label>
                <UnitCombobox
                  code={unitCode}
                  onCodeChange={setUnitCode}
                  query={unitQuery}
                  onQueryChange={setUnitQuery}
                  inputId={unitId}
                  readOnly={!canWrite}
                  placeholder={canWrite ? "Ketik nama satuan..." : ""}
                  inputClassName={`${inputBase} border-transparent ${unitQuery ? "pr-9" : ""}`}
                  panelClassName="border-[rgba(204,195,216,0.4)] py-1"
                />
              </div>

              <div>
                <label htmlFor={descriptionId} className={labelCls}>
                  Deskripsi
                </label>
                <textarea
                  id={descriptionId}
                  readOnly={!canWrite}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  placeholder={canWrite ? "Deskripsi tambahan produk (opsional)" : ""}
                  className={textareaCls}
                />
              </div>
            </div>

            <div className="border-t border-[#ECEEF0] pt-6">
              <div className="flex items-center justify-between gap-6 rounded-md bg-[#F2F4F6] px-6 py-5 max-sm:gap-4 max-sm:px-4">
                <div className="min-w-0 flex-1">
                  <div id={statusLabelId} className="text-sm font-bold leading-5 text-[#191C1E]">
                    Status Produk
                  </div>
                  <div id={statusHintId} className="mt-1 text-caption font-normal text-[#4A4455]">
                    Produk nonaktif tidak muncul di pencarian produk saat menyusun quotation baru.
                    Produk tetap tercantum di Katalog Produk dan pada quotation yang sudah ada.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsActive((a) => !a)}
                  disabled={!canWrite}
                  role="switch"
                  aria-checked={isActive}
                  aria-labelledby={statusLabelId}
                  aria-describedby={statusHintId}
                  className={`relative h-8 w-14 flex-shrink-0 rounded-full transition-colors duration-200 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-60 ${ui.focusRing} ${
                    isActive ? "bg-primary-700" : "bg-dark-300"
                  }`}
                >
                  <span
                    className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.15)] transition-[left] duration-200 motion-reduce:transition-none ${
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
          <div className="mt-2 flex justify-end gap-4 max-sm:flex-col-reverse max-sm:gap-2">
            <button
              type="button"
              onClick={handleCancel}
              disabled={!dirty || updateItem.isPending}
              className={`rounded-lg px-7 py-3 text-sm font-bold ${ui.focusRing} ${
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
              className={`rounded-lg px-8 py-3 text-sm font-bold text-white ${ui.focusRing} ${
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
        )}

        <div className="mt-2 flex flex-col gap-6 rounded-lg bg-white p-8 max-sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <h3 className="text-xl font-extrabold leading-7 tracking-[-0.5px] text-[#191C1E]">
                Daftar Vendor Terkait
              </h3>
              <span className="inline-flex items-center rounded-full bg-[rgba(99,14,212,0.08)] px-2.5 py-[3px] text-[11px] font-bold tracking-[0.2px] text-primary-700">
                {(itemVendors ?? []).length}
              </span>
            </div>
            {canWrite && (
              <button
                type="button"
                className={`${ui.btnPrimary} w-[200px] max-sm:w-full`}
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
                  aria-hidden="true"
                >
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                Tambah Vendor
              </button>
            )}
          </div>

          <div className={ui.tableWrap}>
            <table className="w-full min-w-[640px] border-collapse">
              <thead>
                <tr className={ui.theadRow}>
                  <th className={`${ui.thCenter} w-[280px]`}>Nama Vendor</th>
                  <th className={`${ui.thCenter} w-[200px]`}>SKU Vendor</th>
                  <th className={`${ui.thCenter} w-[180px]`}>Harga Beli</th>
                  <th className={`${ui.thCenter} w-[200px]`}>Penawaran Terakhir</th>
                </tr>
              </thead>
              <tbody>
                {vendorsLoading && <TableLoadingRow colSpan={4} />}
                {!vendorsLoading && (itemVendors ?? []).length === 0 && (
                  <TableEmptyRow colSpan={4}>
                    {canWrite
                      ? 'Belum ada vendor terkait. Klik "Tambah Vendor" untuk menambah.'
                      : "Belum ada vendor terkait."}
                  </TableEmptyRow>
                )}
                {!vendorsLoading &&
                  (itemVendors ?? []).map((v) => {
                    const initials = vendorInitials(v.vendorName)
                    const formattedPrice = formatRupiah(v.costPrice, "-")
                    const formattedDate = formatDate(v.lastQuotedAt) || "-"
                    return (
                      <tr key={v.vendorProductId} className={ui.tr}>
                        <td className={ui.td}>
                          <div className="flex items-center gap-3 pl-4">
                            <div
                              aria-hidden="true"
                              className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-dark-100 text-[13px] font-bold text-primary-700"
                            >
                              {initials}
                            </div>
                            <EntityLink
                              kind="vendor"
                              id={v.vendorId}
                              tone="name"
                              className="text-sm font-medium"
                            >
                              {v.vendorName}
                            </EntityLink>
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
        open={canWrite && showAddVendor}
        itemId={product.id}
        onOpenChange={setShowAddVendor}
      />
    </>
  )
}
