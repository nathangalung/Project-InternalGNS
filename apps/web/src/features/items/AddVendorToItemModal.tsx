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
              <div style={{ position: "relative" }}>
                <input
                  className="ca-input"
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
                  style={{ paddingRight: vendorQuery ? "36px" : undefined }}
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
                {showSuggestions && vendorQuery.length > 0 && (
                  <div style={dropdownPanelStyle}>
                    {filteredVendors.length === 0 ? (
                      <div
                        style={{
                          padding: "12px",
                          display: "flex",
                          flexDirection: "column",
                          gap: "8px",
                        }}
                      >
                        <div
                          style={{
                            fontSize: "13px",
                            color: "#94A3B8",
                            fontFamily: "'Inter', sans-serif",
                            textAlign: "center",
                            padding: "4px 0",
                          }}
                        >
                          Vendor "<strong style={{ color: "#4A4455" }}>{vendorQuery}</strong>" tidak
                          ditemukan
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setShowSuggestions(false)
                            setShowCreateVendor(true)
                          }}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: "8px",
                            padding: "10px 14px",
                            border: "1.5px dashed rgba(99, 14, 212, 0.4)",
                            background: "rgba(99, 14, 212, 0.04)",
                            borderRadius: "8px",
                            cursor: "pointer",
                            fontFamily: "'Inter', sans-serif",
                            fontWeight: 700,
                            fontSize: "13px",
                            color: "#630ED4",
                          }}
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
                <span
                  style={{
                    fontWeight: 400,
                    color: "#9CA3AF",
                    textTransform: "none",
                    letterSpacing: 0,
                  }}
                >
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

        <div className="ca-footer" style={{ padding: "16px 24px" }}>
          {submitError && (
            <span style={{ fontSize: "12px", color: "#EF4444", flex: 1 }}>{submitError}</span>
          )}
          <button
            type="button"
            className="ca-btn-cancel"
            onClick={handleCancel}
            disabled={addVendor.isPending}
            style={{ padding: "8px 18px", fontSize: "13px" }}
          >
            Batal
          </button>
          <button
            type="button"
            className="ca-btn-submit"
            onClick={handleSubmit}
            disabled={!isValid || addVendor.isPending}
            style={{
              padding: "8px 22px",
              fontSize: "13px",
              opacity: !isValid || addVendor.isPending ? 0.5 : 1,
              cursor: !isValid || addVendor.isPending ? "not-allowed" : "pointer",
            }}
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
