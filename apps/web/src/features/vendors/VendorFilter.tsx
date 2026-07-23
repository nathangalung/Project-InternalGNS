import { useState } from "react"
import {
  chipStyle,
  STATUS_FILTER_OPTIONS as STATUS_OPTIONS,
  type StatusFilterValue,
} from "@/components/shared/filter-styles"

export type VendorStatusFilter = StatusFilterValue

export interface VendorFilterValues {
  status: VendorStatusFilter
  countryName: string // free-text location substring; "" means all
  minTotal: string // digits-only string; "" or "0" means no min
}

interface VendorFilterProps {
  onClose: () => void
  onApply: (filters: VendorFilterValues) => void
  initialValues?: VendorFilterValues
}

const DEFAULTS: VendorFilterValues = { status: "all", countryName: "", minTotal: "" }

export default function VendorFilter({ onClose, onApply, initialValues }: VendorFilterProps) {
  const [status, setStatus] = useState<VendorStatusFilter>(initialValues?.status ?? "all")
  const [location, setLocation] = useState<string>(initialValues?.countryName ?? "")
  const [minTotal, setMinTotal] = useState<string>(initialValues?.minTotal ?? "")

  const dirty =
    status !== DEFAULTS.status ||
    location !== DEFAULTS.countryName ||
    (minTotal !== "" && minTotal !== "0")

  const handleReset = () => {
    setStatus("all")
    setLocation("")
    setMinTotal("")
  }

  const handleApply = () => {
    onApply({ status, countryName: location.trim(), minTotal })
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
      <div className="ca-modal" onClick={(e) => e.stopPropagation()}>
        <div className="ca-header">
          <h2 className="ca-title">Filter Vendor</h2>
          <button className="ca-close-btn" onClick={onClose} title="Tutup">
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
            <div className="ca-section-heading">Status Vendor</div>
            <div className="ca-field">
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                {STATUS_OPTIONS.map((o) => (
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
            <div className="ca-section-heading">Lokasi</div>
            <div className="ca-field">
              <input
                type="text"
                placeholder="Ketik lokasi vendor..."
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                style={{
                  width: "100%",
                  height: "44px",
                  padding: "10px 14px",
                  fontSize: "14px",
                  fontFamily: "'Inter', sans-serif",
                  color: "#191C1E",
                  background: "#F7F7F8",
                  border: "1px solid rgba(204, 195, 216, 0.4)",
                  borderRadius: "8px",
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
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
                  onChange={(e) => setMinTotal(e.target.value.replace(/\D/g, ""))}
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
