import { type CSSProperties, useState } from "react"
import { CheckIcon } from "@/components/document/icons"
import {
  dropdownItemStyle,
  dropdownLabelStyle,
  dropdownPanelStyle,
} from "@/components/shared/filter-styles"

export interface DashboardFilterValues {
  year: number
  months: number[] // 0-based month indexes (Jan=0, Dec=11)
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
const YEAR_OPTIONS: number[] = (() => {
  const max = Math.max(CURRENT_YEAR, EARLIEST_YEAR)
  const years: number[] = []
  for (let y = max; y >= EARLIEST_YEAR; y--) years.push(y)
  return years
})()

const MONTH_LABELS: string[] = [
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

const ALL_MONTHS: number[] = Array.from({ length: 12 }, (_, i) => i)

const DEFAULTS: DashboardFilterValues = {
  year: CURRENT_YEAR,
  months: ALL_MONTHS,
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
  const [months, setMonths] = useState<number[]>(initialValues?.months ?? DEFAULTS.months)
  const [yearOpen, setYearOpen] = useState(false)

  const allSelected = months.length === 12
  const dirty =
    year !== DEFAULTS.year ||
    months.length !== DEFAULTS.months.length ||
    months.some((m) => !DEFAULTS.months.includes(m))

  const toggleMonth = (m: number) =>
    setMonths((prev) =>
      prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m].sort((a, b) => a - b),
    )

  const selectAllMonths = () => setMonths(allSelected ? [] : ALL_MONTHS)

  const handleReset = () => {
    setYear(DEFAULTS.year)
    setMonths(DEFAULTS.months)
  }

  const handleApply = () => {
    onApply({ year, months })
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
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: "8px",
              }}
            >
              <div className="ca-section-heading" style={{ marginBottom: 0 }}>
                Pilih Bulan
              </div>
              <button
                type="button"
                onClick={selectAllMonths}
                style={{
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  fontFamily: "'Inter', sans-serif",
                  fontWeight: 500,
                  fontSize: "13px",
                  color: "#630ED4",
                  padding: 0,
                }}
              >
                {allSelected ? "Hapus Semua Bulan" : "Pilih Semua Bulan"}
              </button>
            </div>
            <div className="ca-field">
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "8px" }}>
                {MONTH_LABELS.map((label, idx) => {
                  const isActive = months.includes(idx)
                  return (
                    <button
                      key={label}
                      type="button"
                      onClick={() => toggleMonth(idx)}
                      style={monthChipStyle(isActive)}
                    >
                      {label}
                    </button>
                  )
                })}
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
