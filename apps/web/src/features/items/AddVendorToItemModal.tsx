import { useMemo, useState } from "react"
import { CheckIcon } from "@/components/document/icons"
import {
  dropdownItemStyle,
  dropdownLabelStyle,
  dropdownPanelStyleCompact as dropdownPanelStyle,
} from "@/components/shared/filter-styles"
import { useAddVendorToItem } from "@/features/items/hooks"
import { useVendors } from "@/features/vendors/hooks"
import VendorAddModal from "@/features/vendors/VendorAddModal"
import { ApiError } from "@/lib/api-client"

interface AddVendorToItemModalProps {
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
  const [showCreateVendor, setShowCreateVendor] = useState(false)

  const { data: vendors } = useVendors({ limit: 200 })
  const addVendor = useAddVendorToItem()

  const filteredVendors = useMemo(() => {
    const q = vendorQuery.trim().toLowerCase()
    if (!q) return []
    return (vendors?.rows ?? [])
      .filter(
        (v) => v.name.toLowerCase().includes(q) || (v.location ?? "").toLowerCase().includes(q),
      )
      .slice(0, 5)
  }, [vendors, vendorQuery])

  if (!open) return null

  const isValid = vendorId !== null && costPrice.length > 0 && Number(costPrice) > 0

  const reset = () => {
    setVendorId(null)
    setVendorQuery("")
    setShowSuggestions(false)
    setCostPrice("")
    setProductUrl("")
    setSubmitError(null)
  }

  const handleCancel = () => {
    if (addVendor.isPending) return
    reset()
    onOpenChange(false)
  }

  const handleSubmit = async () => {
    setSubmitError(null)
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
      const msg =
        err instanceof ApiError ? err.message || "Gagal menambah vendor." : "Gagal menambah vendor."
      setSubmitError(msg)
    }
  }

  const formatRupiah = (digits: string) => {
    if (!digits) return ""
    const n = Number(digits)
    if (!Number.isFinite(n)) return ""
    return n.toLocaleString("id-ID")
  }

  return (
    <div className="ca-overlay" onClick={handleCancel}>
      <div className="ca-modal" onClick={(e) => e.stopPropagation()}>
        <div className="ca-header">
          <h2 className="ca-title">Tambah Vendor Terkait</h2>
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
              <div className="relative">
                <input
                  className={`ca-input ${vendorQuery ? "pr-9" : ""}`}
                  type="text"
                  placeholder="Cari vendor..."
                  value={vendorQuery}
                  onChange={(e) => {
                    setVendorQuery(e.target.value)
                    setShowSuggestions(true)
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
                {showSuggestions && vendorQuery.length > 0 && (
                  <div style={dropdownPanelStyle}>
                    {filteredVendors.length === 0 ? (
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
                          className="flex items-center justify-center gap-2 rounded-md border-[1.5px] border-dashed border-[rgba(99,14,212,0.4)] bg-[rgba(99,14,212,0.04)] px-3.5 py-2.5 text-[13px] font-bold text-[#630ED4]"
                        >
                          <svg
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
                      filteredVendors.map((v) => {
                        const active = vendorId === v.id
                        return (
                          <button
                            key={v.id}
                            type="button"
                            style={dropdownItemStyle}
                            onClick={() => {
                              setVendorId(v.id)
                              setVendorQuery(v.name)
                              setShowSuggestions(false)
                            }}
                          >
                            <span style={dropdownLabelStyle(active)}>{v.name}</span>
                            {active && <CheckIcon />}
                          </button>
                        )
                      })
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="ca-section">
            <div className="ca-field">
              <label className="ca-label">
                Harga Beli <span className="ca-required">*</span>
              </label>
              <div className="ca-phone-wrapper">
                <span className="ca-phone-prefix">IDR</span>
                <input
                  className="ca-phone-input"
                  type="text"
                  inputMode="numeric"
                  placeholder="0"
                  value={formatRupiah(costPrice)}
                  onChange={(e) => setCostPrice(e.target.value.replace(/\D/g, ""))}
                />
              </div>
            </div>
          </div>

          <div className="ca-section">
            <div className="ca-field">
              <label className="ca-label">
                Link Produk{" "}
                <span className="font-normal normal-case tracking-normal text-[#9CA3AF]">
                  (opsional)
                </span>
              </label>
              <input
                className="ca-input"
                type="url"
                placeholder="https://vendor.com/produk/..."
                value={productUrl}
                onChange={(e) => setProductUrl(e.target.value)}
              />
            </div>
          </div>
        </div>

        <div className="ca-footer px-6 py-4">
          {submitError && <span className="flex-1 text-[12px] text-error">{submitError}</span>}
          <button
            type="button"
            className="ca-btn-cancel px-[18px] py-2 text-[13px]"
            onClick={handleCancel}
            disabled={addVendor.isPending}
          >
            Batal
          </button>
          <button
            type="button"
            className="ca-btn-submit px-[22px] py-2 text-[13px] disabled:cursor-not-allowed disabled:opacity-50"
            onClick={handleSubmit}
            disabled={!isValid || addVendor.isPending}
          >
            {addVendor.isPending ? "Menyimpan..." : "Tambahkan"}
          </button>
        </div>
      </div>

      <VendorAddModal
        open={showCreateVendor}
        onOpenChange={setShowCreateVendor}
        nested
        onSuccess={(v) => {
          setVendorId(v.id)
          setVendorQuery(v.name)
          setShowSuggestions(false)
        }}
      />
    </div>
  )
}
