import { useMemo, useState } from "react"
import { CheckIcon } from "@/components/document/icons"
import {
  dropdownItemStyle,
  dropdownLabelStyle,
  dropdownPanelStyle,
} from "@/components/shared/filter-styles"
import { useCreateItem } from "@/features/items/hooks"
import { useUnits } from "@/features/units/hooks"

interface ProductCreateModalData {
  nama: string
  kode: string
  satuan: string
  aktif: boolean
}

interface ProductCreateModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: (data: ProductCreateModalData) => void
}

export default function ProductCreateModal({
  open,
  onOpenChange,
  onSuccess,
}: ProductCreateModalProps) {
  const [nama, setNama] = useState("")
  const [kode, setKode] = useState("")
  const [satuan, setSatuan] = useState("")
  const [satuanQuery, setSatuanQuery] = useState("")
  const [showSatuanSuggestions, setShowSatuanSuggestions] = useState(false)
  const [aktif, setAktif] = useState(true)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const { data: units } = useUnits()
  const filteredUnits = useMemo(() => {
    const q = satuanQuery.trim().toLowerCase()
    if (!q) return []
    return (units ?? [])
      .filter((u) => u.code.toLowerCase().includes(q) || (u.name ?? "").toLowerCase().includes(q))
      .slice(0, 5)
  }, [units, satuanQuery])
  const createItem = useCreateItem()

  if (!open) return null

  const isValid = nama.trim().length > 0

  async function handleSubmit() {
    if (!isValid) return
    setSubmitError(null)
    const unit = units?.find((u) => u.code === satuan)
    try {
      await createItem.mutateAsync({
        name: nama.trim(),
        impaCode: kode.trim() || undefined,
        defaultUnitId: unit?.id,
      })
      onSuccess?.({ nama: nama.trim(), kode: kode.trim(), satuan, aktif })
      reset()
      onOpenChange(false)
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Gagal menyimpan produk.")
    }
  }

  function handleCancel() {
    reset()
    onOpenChange(false)
  }

  function reset() {
    setNama("")
    setKode("")
    setSatuan("")
    setSatuanQuery("")
    setShowSatuanSuggestions(false)
    setAktif(true)
    setSubmitError(null)
  }

  return (
    <div className="ca-overlay" onClick={handleCancel}>
      <div className="ca-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="ca-header">
          <h2 className="ca-title">Tambah Produk Baru</h2>
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

        {/* Body */}
        <div className="ca-body">
          <div className="ca-section">
            {/* Nama Produk */}
            <div className="ca-field">
              <label className="ca-label">
                Nama Produk <span className="ca-required">*</span>
              </label>
              <input
                className="ca-input"
                type="text"
                placeholder="Masukkan nama produk..."
                value={nama}
                onChange={(e) => setNama(e.target.value)}
              />
            </div>

            {/* Kode IMPA */}
            <div className="ca-field">
              <label className="ca-label">Kode IMPA</label>
              <input
                className="ca-input"
                type="text"
                inputMode="numeric"
                placeholder="Contoh: 330212"
                value={kode}
                onChange={(e) => setKode(e.target.value.replace(/\D/g, ""))}
              />
            </div>

            {/* Satuan Default — typeahead */}
            <div className="ca-field">
              <label className="ca-label">Satuan Default</label>
              <div style={{ position: "relative" }}>
                <input
                  className="ca-input"
                  type="text"
                  placeholder="Ketik nama satuan..."
                  value={satuanQuery}
                  onChange={(e) => {
                    setSatuanQuery(e.target.value)
                    setShowSatuanSuggestions(true)
                    if (satuan) setSatuan("")
                  }}
                  onFocus={() => {
                    if (satuanQuery.length > 0 && !satuan) setShowSatuanSuggestions(true)
                  }}
                  style={{ paddingRight: satuanQuery ? "36px" : undefined }}
                />
                {satuanQuery && (
                  <button
                    type="button"
                    onClick={() => {
                      setSatuanQuery("")
                      setSatuan("")
                      setShowSatuanSuggestions(false)
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
                {showSatuanSuggestions && satuanQuery.length > 0 && (
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
                        const active = satuan === u.code
                        const label = u.name ? `${u.code} — ${u.name}` : u.code
                        return (
                          <button
                            key={u.id}
                            type="button"
                            style={dropdownItemStyle}
                            onClick={() => {
                              setSatuan(u.code)
                              setSatuanQuery(u.code)
                              setShowSatuanSuggestions(false)
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

            {/* Status Produk */}
            <div
              className="ca-field"
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <label className="ca-label" style={{ margin: 0 }}>
                Status Produk
              </label>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <span
                  style={{
                    fontFamily: "'Inter', sans-serif",
                    fontWeight: 700,
                    fontSize: "12px",
                    color: aktif ? "#630ED4" : "#9CA3AF",
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                  }}
                >
                  {aktif ? "AKTIF" : "NONAKTIF"}
                </span>
                <button
                  type="button"
                  onClick={() => setAktif((a) => !a)}
                  role="switch"
                  aria-checked={aktif}
                  style={{
                    width: "40px",
                    height: "22px",
                    borderRadius: "11px",
                    border: "none",
                    background: aktif ? "#630ED4" : "#D1D5DB",
                    cursor: "pointer",
                    position: "relative",
                    transition: "background 0.2s",
                    flexShrink: 0,
                  }}
                >
                  <span
                    style={{
                      position: "absolute",
                      top: "3px",
                      left: aktif ? "21px" : "3px",
                      width: "16px",
                      height: "16px",
                      borderRadius: "50%",
                      background: "#FFFFFF",
                      transition: "left 0.2s",
                    }}
                  />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="ca-footer" style={{ padding: "16px 24px" }}>
          {submitError && (
            <span style={{ fontSize: "12px", color: "#EF4444", flex: 1 }}>{submitError}</span>
          )}
          <button
            type="button"
            className="ca-btn-cancel"
            onClick={handleCancel}
            disabled={createItem.isPending}
            style={{ padding: "8px 18px", fontSize: "13px" }}
          >
            Batal
          </button>
          <button
            type="button"
            className="ca-btn-submit"
            onClick={handleSubmit}
            disabled={!isValid || createItem.isPending}
            style={{
              padding: "8px 22px",
              fontSize: "13px",
              opacity: !isValid || createItem.isPending ? 0.5 : 1,
              cursor: !isValid || createItem.isPending ? "not-allowed" : "pointer",
            }}
          >
            {createItem.isPending ? "Menyimpan..." : "Tambahkan"}
          </button>
        </div>
      </div>
    </div>
  )
}
