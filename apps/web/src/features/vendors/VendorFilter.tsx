import { useState, type CSSProperties } from "react"
import { useCountries } from "@/features/countries/hooks"

export type VendorStatusFilter = "all" | "active" | "inactive"

export interface VendorFilterValues {
  status: VendorStatusFilter
  countryName: string  // free text country name to match against location; "" means all
  minTotal: string     // digits-only string; "" or "0" means no min
}

interface VendorFilterProps {
  onClose: () => void
  onApply: (filters: VendorFilterValues) => void
  initialValues?: VendorFilterValues
}

const STATUS_OPTIONS: { value: VendorStatusFilter; label: string }[] = [
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

const DEFAULTS: VendorFilterValues = { status: "all", countryName: "", minTotal: "" }

export default function VendorFilter({ onClose, onApply, initialValues }: VendorFilterProps) {
  const [status, setStatus] = useState<VendorStatusFilter>(initialValues?.status ?? "all")
  const [countryName, setCountryName] = useState<string>(initialValues?.countryName ?? "")
  const [countryQuery, setCountryQuery] = useState<string>(initialValues?.countryName ?? "")
  const [minTotal, setMinTotal] = useState<string>(initialValues?.minTotal ?? "")
  const [showCountrySuggestions, setShowCountrySuggestions] = useState(false)

  const { data: countries } = useCountries()

  const filteredCountries = (countries ?? []).filter(c => {
    if (!countryQuery) return true
    const q = countryQuery.toLowerCase()
    return c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q)
  })

  const dirty =
    status !== DEFAULTS.status ||
    countryName !== DEFAULTS.countryName ||
    (minTotal !== "" && minTotal !== "0")

  const handleReset = () => {
    setStatus("all")
    setCountryName("")
    setCountryQuery("")
    setMinTotal("")
    setShowCountrySuggestions(false)
  }

  const handleApply = () => {
    onApply({ status, countryName, minTotal })
    onClose()
  }

  const formatRupiah = (digits: string) => {
    if (!digits) return ""
    const n = Number(digits)
    if (!Number.isFinite(n)) return ""
    return n.toLocaleString("id-ID")
  }

  return (
    <div className="ca-overlay" onClick={onClose}>
      <div className="ca-modal" onClick={e => e.stopPropagation()}>

        <div className="ca-header">
          <h2 className="ca-title">Filter Vendor</h2>
          <button className="ca-close-btn" onClick={onClose} title="Tutup">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="1" y1="1" x2="13" y2="13" />
              <line x1="13" y1="1" x2="1" y2="13" />
            </svg>
          </button>
        </div>

        <div className="ca-body">

          <div className="ca-section">
            <div className="ca-section-heading">Status Vendor</div>
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
            <div className="ca-section-heading">Negara Asal</div>
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
                  placeholder="Ketik nama negara..."
                  value={countryQuery}
                  onChange={e => {
                    setCountryQuery(e.target.value)
                    setShowCountrySuggestions(true)
                    if (countryName) setCountryName("")
                  }}
                  onFocus={() => {
                    if (countryQuery.length > 0 && !countryName) setShowCountrySuggestions(true)
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
                {countryQuery && (
                  <button
                    type="button"
                    onClick={() => {
                      setCountryQuery("")
                      setCountryName("")
                      setShowCountrySuggestions(false)
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
                      justifyContent: "center",
                      color: "#94A3B8",
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <line x1="1" y1="1" x2="13" y2="13" />
                      <line x1="13" y1="1" x2="1" y2="13" />
                    </svg>
                  </button>
                )}
                {showCountrySuggestions && countryQuery.length > 0 && (
                  <div style={{
                    position: "absolute",
                    top: "calc(100% + 4px)",
                    left: 0,
                    right: 0,
                    maxHeight: "200px",
                    overflowY: "auto",
                    background: "#FFFFFF",
                    border: "1px solid rgba(204, 195, 216, 0.4)",
                    borderRadius: "8px",
                    boxShadow: "0 4px 12px rgba(0, 0, 0, 0.08)",
                    padding: "4px 0",
                    zIndex: 50,
                  }}>
                    {filteredCountries.length === 0 ? (
                      <div style={{ padding: "12px 20px", fontSize: "13px", color: "#94A3B8", fontFamily: "'Inter', sans-serif", textAlign: "center" }}>
                        Tidak ada hasil
                      </div>
                    ) : (
                      filteredCountries.slice(0, 5).map(c => {
                        const active = countryName.toLowerCase() === c.name.toLowerCase()
                        return (
                          <button
                            key={c.code}
                            type="button"
                            style={dropdownItemStyle}
                            onClick={() => {
                              setCountryName(c.name)
                              setCountryQuery(c.name)
                              setShowCountrySuggestions(false)
                            }}
                          >
                            <span style={dropdownLabelStyle(active)}>{c.name}</span>
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
            <div className="ca-section-heading">Min Total Pembelian</div>
            <div className="ca-field">
              <div className="ca-phone-wrapper">
                <span className="ca-phone-prefix">IDR</span>
                <input
                  className="ca-phone-input"
                  type="text"
                  inputMode="numeric"
                  placeholder="0"
                  value={formatRupiah(minTotal)}
                  onChange={e => setMinTotal(e.target.value.replace(/\D/g, ""))}
                />
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
