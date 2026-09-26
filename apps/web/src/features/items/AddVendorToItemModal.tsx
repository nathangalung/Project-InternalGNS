import { useId, useState } from "react"
import { CheckIcon } from "@/components/document/icons"
import Modal from "@/components/shared/Modal"
import { addVendorError } from "@/features/items/helpers"
import { useActiveVendorOptions, useAddVendorToItem } from "@/features/items/hooks"
import VendorAddModal from "@/features/vendors/VendorAddModal"
import { useDebouncedValue } from "@/hooks/useDebouncedValue"
import { dropdownLabel, ui } from "@/lib/ui"

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
  const [vendorId, setVendorId] = useState<number | null>(null)
  const [vendorQuery, setVendorQuery] = useState("")
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [costPrice, setCostPrice] = useState("")
  const [productUrl, setProductUrl] = useState("")
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [vendorError, setVendorError] = useState<string | null>(null)
  const [showCreateVendor, setShowCreateVendor] = useState(false)
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

  const isValid = vendorId !== null && costPrice.length > 0 && Number(costPrice) > 0

  const reset = () => {
    setVendorId(null)
    setVendorQuery("")
    setShowSuggestions(false)
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
            <div className="relative">
              <input
                id={vendorInputId}
                className={`${ui.fieldInput} font-sans ${vendorQuery ? "pr-9" : ""} ${
                  vendorError ? "border-error" : ""
                }`}
                type="text"
                placeholder="Cari vendor aktif..."
                autoComplete="off"
                aria-invalid={vendorError ? true : undefined}
                aria-describedby={vendorError ? vendorErrorId : undefined}
                value={vendorQuery}
                onChange={(e) => {
                  setVendorQuery(e.target.value)
                  setShowSuggestions(true)
                  setVendorError(null)
                  if (vendorId) setVendorId(null)
                }}
                onFocus={() => {
                  if (vendorQuery.length > 0 && !vendorId) setShowSuggestions(true)
                }}
              />
              {vendorQuery && (
                <button
                  type="button"
                  onClick={() => {
                    setVendorQuery("")
                    setVendorId(null)
                    setShowSuggestions(false)
                  }}
                  title="Bersihkan"
                  aria-label="Bersihkan vendor"
                  className={`absolute right-2.5 top-1/2 flex -translate-y-1/2 items-center rounded-sm p-1 text-[#94A3B8] ${ui.focusRing}`}
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 14 14"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    aria-hidden="true"
                  >
                    <line x1="1" y1="1" x2="13" y2="13" />
                    <line x1="13" y1="1" x2="1" y2="13" />
                  </svg>
                </button>
              )}
              {showSuggestions && vendorQuery.length > 0 && (
                <div className={ui.dropdownPanelCompact}>
                  {searching && vendorMatches.length === 0 ? (
                    <div role="status" className="px-5 py-3 text-center text-[13px] text-dark-500">
                      Mencari vendor…
                    </div>
                  ) : vendorMatches.length === 0 ? (
                    <div className="flex flex-col gap-2 p-3">
                      <div className="px-0 py-1 text-center text-[13px] text-[#94A3B8]">
                        Vendor "<strong className="text-[#4A4455]">{vendorQuery}</strong>" tidak
                        ditemukan
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setShowSuggestions(false)
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
                  ) : (
                    vendorMatches.map((v) => {
                      const active = vendorId === v.id
                      return (
                        <button
                          key={v.id}
                          type="button"
                          className={ui.dropdownItem}
                          onClick={() => {
                            setVendorId(v.id)
                            setVendorQuery(v.name)
                            setShowSuggestions(false)
                            setVendorError(null)
                          }}
                        >
                          <span className="flex min-w-0 flex-col">
                            <span className={dropdownLabel(active)}>{v.name}</span>
                            {v.location && (
                              <span className="text-[12px] text-dark-500">{v.location}</span>
                            )}
                          </span>
                          {active && <CheckIcon />}
                        </button>
                      )
                    })
                  )}
                </div>
              )}
            </div>
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
          setVendorId(v.id)
          setVendorQuery(v.name)
          setShowSuggestions(false)
          setVendorError(null)
        }}
      />
    </>
  )
}
