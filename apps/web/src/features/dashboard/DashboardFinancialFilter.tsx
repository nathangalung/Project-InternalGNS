import { useState } from "react"
import { CheckIcon } from "@/components/document/icons"
import {
  dropdownItemStyle,
  dropdownLabelStyle,
  dropdownPanelStyle,
} from "@/components/shared/filter-styles"
import Modal from "@/components/shared/Modal"
import { ui } from "@/lib/ui"

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

// Faithful port of the legacy .ca-select-btn
const selectBtnClass =
  "flex w-full cursor-pointer items-center justify-between rounded-md border-[1.5px] border-transparent bg-dark-200 px-4 py-3 font-sans text-sm font-normal text-dark-900 outline-none transition-colors duration-200 focus:border-primary-600 focus:shadow-[0_0_0_3px_rgba(124,58,237,0.12)]"

// Month chip: solid fill when active, muted surface when idle.
const monthChip = "rounded-md px-3.5 py-3 text-center text-[13px] transition-all duration-150"
const monthChipActive = "border-[1.5px] border-[#630ED4] bg-[#630ED4] font-semibold text-white"
const monthChipIdle = "border border-[#E5E7EB] bg-[#F7F7F8] font-medium text-[#4A4455]"

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
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            onClick={handleReset}
            disabled={!dirty}
            className={`mr-auto inline-flex items-center gap-1.5 border-0 bg-transparent p-0 text-[13px] font-medium underline-offset-[3px] ${
              dirty
                ? "cursor-pointer text-[#630ED4] underline"
                : "cursor-default text-[#CBD5E1] no-underline"
            }`}
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
          <button type="button" className={ui.modalCancel} onClick={onClose}>
            Batal
          </button>
          <button type="button" className={ui.modalSubmit} onClick={handleApply}>
            Terapkan
          </button>
        </>
      }
    >
      <p className="m-0 text-[12px] text-[#64748B]">
        Pilih bulan untuk melihat rincian harian pada grafik tren. Kartu ringkasan tetap menampilkan
        total keseluruhan.
      </p>

      {/* Pilih Tahun */}
      <div className={ui.modalSection}>
        <div className={ui.modalSectionHeading}>Pilih Tahun</div>
        <div className={ui.field}>
          <div className="relative">
            <button
              type="button"
              className={selectBtnClass}
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

      {/* Pilih Bulan */}
      <div className={ui.modalSection}>
        <div className={ui.modalSectionHeading}>Pilih Bulan</div>
        <div className={ui.field}>
          <button
            type="button"
            onClick={() => setMonth(null)}
            className={`${monthChip} mb-2 w-full ${month === null ? monthChipActive : monthChipIdle}`}
          >
            Semua Bulan
          </button>
          <div className="grid grid-cols-4 gap-2">
            {MONTH_LABELS.map((label, idx) => (
              <button
                key={label}
                type="button"
                onClick={() => pickMonth(idx)}
                className={`${monthChip} ${month === idx ? monthChipActive : monthChipIdle}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  )
}
