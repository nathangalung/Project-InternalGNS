import { useState, type CSSProperties } from "react"
import { useUnits } from "@/features/units/hooks"

export type ProductStatusFilter = "all" | "active" | "inactive"

export interface ProductFilterValues {
  status: ProductStatusFilter
  unitCode: string  // "" means all
}

interface ProductFilterProps {
  onClose: () => void
  onApply: (filters: ProductFilterValues) => void
  initialValues?: ProductFilterValues
}

const STATUS_OPTIONS: { value: ProductStatusFilter; label: string }[] = [
  { value: "all",      label: "Semua" },
  { value: "active",   label: "Aktif" },
  { value: "inactive", label: "Nonaktif" },
]

function chipStyle(active: boolean): CSSProperties {
  return {
    padding: "8px 18px",
    borderRadius: "999px",
    border: active ? "1.5px solid #630ED4" : "1px solid #E5E7EB",
    background: active ? "rgba(99, 14, 212, 0.06)" : "#FFFFFF",
    cursor: "pointer",
    fontFamily: "'Inter', sans-serif",
    fontWeight: active ? 600 : 500,
    fontSize: "13px",
    color: active ? "#630ED4" : "#4A4455",
    transition: "all 0.15s",
  }
}

const dropdownItemStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
  padding: "10px 20px",
  width: "100%",
  background: "transparent",
  border: "none",
  cursor: "pointer",
  textAlign: "left",
}

function dropdownLabelStyle(active: boolean): CSSProperties {
  return {
    fontFamily: "'Inter', sans-serif",
    fontWeight: active ? 700 : 500,
    fontSize: "14px",
    lineHeight: "20px",
    color: active ? "#630ED4" : "#4A4455",
  }
}

const CheckIcon = () => (
  <svg width="14" height="11" viewBox="0 0 14 11" fill="none">
    <path d="M1 5.5L4.5 9L13 1" stroke="#630ED4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const DEFAULTS: ProductFilterValues = { status: "all", unitCode: "" }

export default function ProductFilter({ onClose, onApply, initialValues }: ProductFilterProps) {
  const [status, setStatus] = useState<ProductStatusFilter>(initialValues?.status ?? "all")
  const [unitCode, setUnitCode] = useState<string>(initialValues?.unitCode ?? "")
  const [unitQuery, setUnitQuery] = useState<string>(initialValues?.unitCode ?? "")
  const [showUnitSuggestions, setShowUnitSuggestions] = useState(false)

  const { data: units } = useUnits()

  const filteredUnits = (units ?? [])
    .filter(u => {
      if (!unitQuery) return true
      const q = unitQuery.toLowerCase()
      return u.code.toLowerCase().includes(q) || (u.name ?? "").toLowerCase().includes(q)
    })
    .slice(0, 5)

  const dirty = status !== DEFAULTS.status || unitCode !== DEFAULTS.unitCode

  const handleReset = () => {
    setStatus("all")
    setUnitCode("")
    setUnitQuery("")
    setShowUnitSuggestions(false)
  }

  const handleApply = () => {
    onApply({ status, unitCode })
    onClose()
  }

  return (
    <div className="ca-overlay" onClick={onClose}>
      <div className="ca-modal" onClick={e => e.stopPropagation()}>

        <div className="ca-header">
          <h2 className="ca-title">Filter Produk</h2>
          <button className="ca-close-btn" onClick={onClose} title="Tutup">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="1" y1="1" x2="13" y2="13" />
              <line x1="13" y1="1" x2="1" y2="13" />
            </svg>
          </button>
        </div>

        <div className="ca-body">

          <div className="ca-section">
            <div className="ca-section-heading">Status Produk</div>
            <div className="ca-field">
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                {STATUS_OPTIONS.map(o => (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => setStatus(o.value)}
                    style={chipStyle(status === o.value)}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="ca-section">
            <div className="ca-section-heading">Satuan</div>
            <div className="ca-field">
              <div style={{ position: "relative" }}>
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#94A3B8"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}
                >
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <input
                  type="text"
                  placeholder="Ketik nama satuan..."
                  value={unitQuery}
                  onChange={e => {
                    setUnitQuery(e.target.value)
                    setShowUnitSuggestions(true)
                    if (unitCode) setUnitCode("")
                  }}
                  onFocus={() => {
                    if (unitQuery.length > 0 && !unitCode) setShowUnitSuggestions(true)
                  }}
                  style={{
                    width: "100%",
                    height: "44px",
                    padding: "10px 36px 10px 36px",
                    fontSize: "14px",
                    fontFamily: "'Inter', sans-serif",
                    color: "#191C1E",
                    background: "#F7F7F8",
                    border: "1px solid rgba(204, 195, 216, 0.4)",
                    borderRadius: "8px",
                    outline: "none",
                  }}
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
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <line x1="1" y1="1" x2="13" y2="13" />
                      <line x1="13" y1="1" x2="1" y2="13" />
                    </svg>
                  </button>
                )}
                {showUnitSuggestions && unitQuery.length > 0 && (
                  <div style={{
                    position: "absolute",
                    top: "calc(100% + 4px)",
                    left: 0,
                    right: 0,
                    maxHeight: "240px",
                    overflowY: "auto",
                    background: "#FFFFFF",
                    border: "1px solid rgba(204, 195, 216, 0.4)",
                    borderRadius: "8px",
                    boxShadow: "0 4px 12px rgba(0, 0, 0, 0.08)",
                    padding: "4px 0",
                    zIndex: 50,
                  }}>
                    {filteredUnits.length === 0 ? (
                      <div style={{ padding: "12px 20px", fontSize: "13px", color: "#94A3B8", fontFamily: "'Inter', sans-serif", textAlign: "center" }}>
                        Tidak ada hasil
                      </div>
                    ) : (
                      filteredUnits.map(u => {
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
          </div>

        </div>

        <div
          className="ca-footer"
          style={{ justifyContent: "space-between", padding: "16px 24px" }}
        >
          <button
            type="button"
            onClick={handleReset}
            disabled={!dirty}
            style={{
              background: "transparent",
              border: "none",
              cursor: dirty ? "pointer" : "default",
              fontFamily: "'Inter', sans-serif",
              fontWeight: 500,
              fontSize: "13px",
              color: dirty ? "#630ED4" : "#CBD5E1",
              padding: 0,
              textDecoration: dirty ? "underline" : "none",
              textUnderlineOffset: "3px",
            }}
          >
            Hapus Filter
          </button>
          <div style={{ display: "flex", gap: "8px" }}>
            <button
              type="button"
              className="ca-btn-cancel"
              onClick={onClose}
              style={{ padding: "8px 18px", fontSize: "13px" }}
            >
              Batal
            </button>
            <button
              type="button"
              className="ca-btn-submit"
              onClick={handleApply}
              style={{ padding: "8px 22px", fontSize: "13px" }}
            >
              Terapkan
            </button>
          </div>
        </div>

      </div>
    </div>
  )
}
