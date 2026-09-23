import { type FocusEvent, type KeyboardEvent, useId, useRef, useState } from "react"
import { CheckIcon } from "@/components/document/icons"
import FilterFooter from "@/components/shared/FilterFooter"
import Modal from "@/components/shared/Modal"
import { dropdownLabel, ui } from "@/lib/ui"

export type DashboardFilterValues = {
  year: number
  month: number | null // 0-based index (Jan=0); null = whole year
}

type DashboardFinancialFilterProps = {
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

// Month chip, active or idle.
//
// Three columns and tight padding below 640px keep "September" whole at 320px.
const monthChip = `rounded-md px-1 py-3 text-center sm:px-3.5 text-[13px] transition-colors duration-150 ${ui.focusRing}`
const monthChipActive = "border-[1.5px] border-primary-700 bg-primary-700 font-semibold text-white"
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
  const yearHeadingId = useId()
  // Close when focus leaves
  const yearRef = useRef<HTMLDivElement>(null)
  const yearTriggerRef = useRef<HTMLButtonElement>(null)
  const closeYearOnBlur = (e: FocusEvent<HTMLButtonElement>) => {
    if (!yearRef.current?.contains(e.relatedTarget)) setYearOpen(false)
  }
  // Escape closes list only.
  //
  // Stopping the event keeps the surrounding modal open.
  const yearKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== "Escape" || !yearOpen) return
    e.stopPropagation()
    setYearOpen(false)
    yearTriggerRef.current?.focus()
  }

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
        <FilterFooter
          onReset={handleReset}
          canReset={dirty}
          onCancel={onClose}
          onApply={handleApply}
        />
      }
    >
      <p className="m-0 text-[12px] text-[#64748B]">
        Pilih bulan untuk melihat rincian harian pada grafik tren. Kartu ringkasan tetap menampilkan
        total keseluruhan.
      </p>

      {/* Pilih Tahun */}
      <div className={ui.modalSection}>
        <div id={yearHeadingId} className={ui.modalSectionHeading}>
          Pilih Tahun
        </div>
        <div className={ui.field}>
          <div ref={yearRef} className="relative">
            <button
              ref={yearTriggerRef}
              type="button"
              className={ui.selectBtn}
              onBlur={closeYearOnBlur}
              onKeyDown={yearKeyDown}
              aria-labelledby={`${yearHeadingId} ${yearHeadingId}-value`}
              aria-expanded={yearOpen}
              onClick={() => setYearOpen((o) => !o)}
            >
              <span id={`${yearHeadingId}-value`}>{year}</span>
              <svg
                aria-hidden="true"
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
              <div className={ui.dropdownPanel}>
                {YEAR_OPTIONS.map((y) => {
                  const isActive = year === y
                  return (
                    <button
                      key={y}
                      type="button"
                      className={ui.dropdownItem}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setYear(y)
                        setYearOpen(false)
                      }}
                      onBlur={closeYearOnBlur}
                      onKeyDown={yearKeyDown}
                    >
                      <span className={dropdownLabel(isActive)}>{y}</span>
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
            aria-pressed={month === null}
            onClick={() => setMonth(null)}
            className={`${monthChip} mb-2 w-full ${month === null ? monthChipActive : monthChipIdle}`}
          >
            Semua Bulan
          </button>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {MONTH_LABELS.map((label, idx) => (
              <button
                key={label}
                type="button"
                aria-pressed={month === idx}
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
