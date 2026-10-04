import { useId, useState } from "react"
import LoadError from "@/components/shared/LoadError"
import Modal from "@/components/shared/Modal"
import SearchCombobox from "@/components/shared/SearchCombobox"
import { addVendorError } from "@/features/items/helpers"
import { useActiveVendorOptions, useAddVendorToItem } from "@/features/items/hooks"
import VendorAddModal from "@/features/vendors/VendorAddModal"
import { useDebouncedValue } from "@/hooks/useDebouncedValue"
import { ui } from "@/lib/ui"
import type { VendorRow } from "@/types/api"

type AddVendorToItemModalProps = {
  open: boolean
  itemId: number
  onOpenChange: (open: boolean) => void
}

export default function AddVendorToItemModal({
  open,
  itemId,
  onOpenChange,
}: AddVendorToItemModalProps) {
  // Picked vendor, kept while searches change
  const [vendor, setVendor] = useState<VendorRow | null>(null)
  const [vendorQuery, setVendorQuery] = useState("")
  const [costPrice, setCostPrice] = useState("")
  const [productUrl, setProductUrl] = useState("")
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [vendorError, setVendorError] = useState<string | null>(null)
  const [showCreateVendor, setShowCreateVendor] = useState(false)
  const [vendorListOpen, setVendorListOpen] = useState(false)
  const vendorInputId = useId()
  const vendorErrorId = useId()
  const priceInputId = useId()
  const urlInputId = useId()

  // Server search reaches every active vendor.
  const debouncedQuery = useDebouncedValue(vendorQuery.trim(), 250)
  const vendorSearch = useActiveVendorOptions(debouncedQuery)
  const vendorMatches = vendorSearch.data?.rows ?? []
  const searching = vendorQuery.trim() !== debouncedQuery || vendorSearch.isFetching
  const addVendor = useAddVendorToItem()

  if (!open) return null

  const vendorId = vendor?.id ?? null

  const isValid = vendorId !== null && costPrice.length > 0 && Number(costPrice) > 0

  const reset = () => {
    setVendor(null)
    setVendorQuery("")
    setVendorListOpen(false)
    setCostPrice("")
    setProductUrl("")
    setSubmitError(null)
    setVendorError(null)
  }

  const handleCancel = () => {
    if (addVendor.isPending) return
    reset()
    onOpenChange(false)
  }

  const handleSubmit = async () => {
    setSubmitError(null)
    setVendorError(null)
    if (!isValid || vendorId === null) return
    const trimmedUrl = productUrl.trim()
    try {
      await addVendor.mutateAsync({
        itemId,
        input: {
          vendorId,
          costPrice,
          productUrl: trimmedUrl ? trimmedUrl : undefined,
        },
      })
      reset()
      onOpenChange(false)
    } catch (err) {
      const placed = addVendorError(err)
      setVendorError(placed.field ?? null)
      setSubmitError(placed.form ?? null)
    }
  }

  const formatRupiah = (digits: string) => {
    if (!digits) return ""
    const n = Number(digits)
    if (!Number.isFinite(n)) return ""
    return n.toLocaleString("id-ID")
  }

  return (
    <>
      <Modal
        title="Tambah Vendor Terkait"
        onClose={handleCancel}
        footer={
          <>
            {submitError && (
              <span role="alert" className="flex-1 text-[12px] text-error">
                {submitError}
              </span>
            )}
            <div className="flex gap-4 max-sm:w-full max-sm:*:flex-1 max-sm:*:px-4">
              <button
                type="button"
                className={ui.modalCancel}
                onClick={handleCancel}
                disabled={addVendor.isPending}
              >
                Batal
              </button>
              <button
                type="button"
                className={ui.modalSubmit}
                onClick={handleSubmit}
                disabled={!isValid || addVendor.isPending}
              >
                {addVendor.isPending ? "Menyimpan..." : "Tambahkan"}
              </button>
            </div>
          </>
        }
      >
        <div className={ui.modalSection}>
          <div className={ui.field}>
            <label htmlFor={vendorInputId} className={ui.fieldLabel}>
              Nama Vendor <span className="text-primary-700">*</span>
            </label>
            <SearchCombobox<VendorRow>
              items={vendorMatches}
              value={vendor}
              onValueChange={(v) => {
                setVendor(v)
                setVendorError(null)
              }}
              open={vendorListOpen}
              onOpenChange={setVendorListOpen}
              query={vendorQuery}
              onQueryChange={(q) => {
                setVendorQuery(q)
                setVendorError(null)
              }}
              itemKey={(v) => v.id}
              itemToString={(v) => v.name}
              renderItem={(v) => (
                <span className="flex min-w-0 flex-col">
                  <span>{v.name}</span>
                  {v.location && (
                    <span className="text-[12px] font-normal leading-6 text-dark-500">
                      {v.location}
                    </span>
                  )}
                </span>
              )}
              inputId={vendorInputId}
              placeholder="Cari vendor aktif..."
              aria-invalid={vendorError ? true : undefined}
              aria-describedby={vendorError ? vendorErrorId : undefined}
              clearLabel="Bersihkan vendor"
              inputClassName={`${ui.fieldInput} font-sans ${vendorQuery ? "pr-9" : ""} ${
                vendorError ? "border-error" : ""
              }`}
              panelClassName="border-[rgba(204,195,216,0.4)] py-1"
              status={
                vendorSearch.isError ? (
                  <LoadError
                    message="Gagal memuat vendor."
                    onRetry={() => void vendorSearch.refetch()}
                    retrying={vendorSearch.isFetching}
                    className="px-5 py-3"
                  />
                ) : searching && vendorMatches.length === 0 ? (
                  <div className="px-5 py-3 text-center text-[13px] text-dark-500">
                    Mencari vendor…
                  </div>
                ) : null
              }
              empty={
                <div className="flex flex-col gap-2 p-3">
                  <div className="px-0 py-1 text-center text-[13px] text-[#94A3B8]">
                    Vendor "<strong className="text-[#4A4455]">{vendorQuery}</strong>" tidak
                    ditemukan
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      // Nested modal returns focus to the field.
                      document.getElementById(vendorInputId)?.focus()
                      setVendorListOpen(false)
                      setShowCreateVendor(true)
                    }}
                    className={`flex items-center justify-center gap-2 rounded-md border-[1.5px] border-dashed border-[rgba(99,14,212,0.4)] bg-[rgba(99,14,212,0.04)] px-3.5 py-2.5 text-[13px] font-bold text-primary-700 ${ui.focusRing}`}
                  >
                    <svg
                      aria-hidden="true"
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                    >
                      <line x1="12" y1="5" x2="12" y2="19" />
                      <line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                    Tambah Vendor Baru
                  </button>
                </div>
              }
            />
            {vendorError && (
              <p id={vendorErrorId} className="text-[12px] text-error">
                {vendorError}
              </p>
            )}
          </div>
        </div>

        <div className={ui.modalSection}>
          <div className={ui.field}>
            <label htmlFor={priceInputId} className={ui.fieldLabel}>
              Harga Beli <span className="text-primary-700">*</span>
            </label>
            <div className={ui.prefixWrap}>
              <span className="flex items-center whitespace-nowrap border-r border-dark-300 px-3 text-sm font-medium text-dark-600">
                IDR
              </span>
              <input
                id={priceInputId}
                className="flex-1 border-none bg-transparent px-3 py-0 font-sans text-sm text-dark-900 outline-none placeholder:text-dark-500"
                type="text"
                inputMode="numeric"
                placeholder="0"
                value={formatRupiah(costPrice)}
                onChange={(e) => setCostPrice(e.target.value.replace(/\D/g, ""))}
              />
            </div>
          </div>
        </div>

        <div className={ui.modalSection}>
          <div className={ui.field}>
            <label htmlFor={urlInputId} className={ui.fieldLabel}>
              Link Produk{" "}
              <span className="font-normal normal-case tracking-normal text-[#9CA3AF]">
                (opsional)
              </span>
            </label>
            <input
              id={urlInputId}
              className={`${ui.fieldInput} font-sans`}
              type="url"
              placeholder="https://vendor.com/produk/..."
              value={productUrl}
              onChange={(e) => setProductUrl(e.target.value)}
            />
          </div>
        </div>
      </Modal>

      <VendorAddModal
        open={showCreateVendor}
        onOpenChange={setShowCreateVendor}
        nested
        onSuccess={(v) => {
          setVendor(v)
          setVendorQuery(v.name)
          setVendorError(null)
        }}
      />
    </>
  )
}
