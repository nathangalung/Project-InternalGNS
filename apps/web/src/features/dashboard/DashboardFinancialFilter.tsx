import { type CSSProperties, useState } from "react"
import { CheckIcon } from "@/components/document/icons"
import {
  dropdownItemStyle,
  dropdownLabelStyle,
  dropdownPanelStyle,
} from "@/components/shared/filter-styles"

export interface DashboardFilterValues {
  year: number
  month: number | null // 0-based index (Jan=0); null = whole year
}

interface DashboardFinancialFilterProps {
  onClose: () => void
  onApply: (filters: DashboardFilterValues) => void
  initialValues?: DashboardFilterValues
  title?: string
}

const EARLIEST_YEAR = 2024
const CURRENT_YEAR = new Date().getFullYear()
// Earliest year is fixed at 2024; latest extends with the current year (2024..now), descending.
export const YEAR_OPTIONS: number[] = (() => {
  const max = Math.max(CURRENT_YEAR, EARLIEST_YEAR)
  const years: number[] = []
  for (let y = max; y >= EARLIEST_YEAR; y--) years.push(y)
  return years
})()

export const MONTH_LABELS: string[] = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
]

const DEFAULTS: DashboardFilterValues = {
  year: CURRENT_YEAR,
  month: null,
}

function monthChipStyle(active: boolean): CSSProperties {
  return {
    padding: "12px 14px",
    borderRadius: "8px",
    border: active ? "1.5px solid #630ED4" : "1px solid #E5E7EB",
    background: active ? "#630ED4" : "#F7F7F8",
    cursor: "pointer",
    fontFamily: "'Inter', sans-serif",
    fontWeight: active ? 600 : 500,
    fontSize: "13px",
    color: active ? "#FFFFFF" : "#4A4455",
    transition: "all 0.15s",
    textAlign: "center",
  }
}

export default function DashboardFinancialFilter({
  onClose,
  onApply,
  initialValues,
  title = "Filter Dashboard Finansial",
}: DashboardFinancialFilterProps) {
  const [year, setYear] = useState<number>(initialValues?.year ?? DEFAULTS.year)
  const [month, setMonth] = useState<number | null>(initialValues?.month ?? DEFAULTS.month)
  const [yearOpen, setYearOpen] = useState(false)

  const dirty = year !== DEFAULTS.year || month !== DEFAULTS.month

  // Clicking the active month clears back to the whole year.
  const pickMonth = (m: number) => setMonth((prev) => (prev === m ? null : m))

  const handleReset = () => {
    setYear(DEFAULTS.year)
    setMonth(DEFAULTS.month)
  }

  const handleApply = () => {
    onApply({ year, month })
    onClose()
  }

  return (
    <div className="ca-overlay" onClick={onClose}>
      <div className="ca-modal" onClick={(e) => e.stopPropagation()}>
        <div className="ca-header">
          <h2 className="ca-title">{title}</h2>
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
          <p
            style={{
              margin: 0,
              fontFamily: "'Inter', sans-serif",
              fontSize: "12px",
              color: "#64748B",
            }}
          >
            Pilih bulan untuk melihat rincian harian pada grafik tren. Kartu ringkasan tetap
            menampilkan total keseluruhan.
          </p>
          <div className="ca-section">
            <div className="ca-section-heading">Pilih Tahun</div>
            <div className="ca-field">
              <div className="ca-select-wrapper">
                <button
                  type="button"
                  className="ca-select-btn"
                  onClick={() => setYearOpen((o) => !o)}
                  onBlur={() => setTimeout(() => setYearOpen(false), 150)}
                >
                  <span>{year}</span>
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>
                {yearOpen && (
                  <div style={dropdownPanelStyle}>
                    {YEAR_OPTIONS.map((y) => {
                      const isActive = year === y
                      return (
                        <button
                          key={y}
                          type="button"
                          style={dropdownItemStyle}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            setYear(y)
                            setYearOpen(false)
                          }}
                        >
                          <span style={dropdownLabelStyle(isActive)}>{y}</span>
                          {isActive && <CheckIcon />}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="ca-section">
            <div className="ca-section-heading">Pilih Bulan</div>
            <div className="ca-field">
              <button
                type="button"
                onClick={() => setMonth(null)}
                style={{ ...monthChipStyle(month === null), width: "100%", marginBottom: "8px" }}
              >
                Semua Bulan
              </button>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "8px" }}>
                {MONTH_LABELS.map((label, idx) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => pickMonth(idx)}
                    style={monthChipStyle(month === idx)}
                  >
                    {label}
                  </button>
                ))}
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
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              textDecoration: dirty ? "underline" : "none",
              textUnderlineOffset: "3px",
            }}
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="1 4 1 10 7 10" />
              <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
            </svg>
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
