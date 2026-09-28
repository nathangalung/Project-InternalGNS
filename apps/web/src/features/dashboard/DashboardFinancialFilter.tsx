import { useId, useState } from "react"
import FilterFooter from "@/components/shared/FilterFooter"
import Modal from "@/components/shared/Modal"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { yearInJakarta } from "@/lib/date-range"
import { ui } from "@/lib/ui"

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
const CURRENT_YEAR = yearInJakarta()
// Year options, newest first.
//
// The earliest year is fixed at 2024; the latest extends with the current year
// (2024..now).
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
  const yearHeadingId = useId()

  const dirty = year !== DEFAULTS.year || month !== DEFAULTS.month

  // Reclick returns to whole year.
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
          <Select
            modal={false}
            value={year}
            onValueChange={(y) => {
              if (y !== null) setYear(y)
            }}
          >
            <SelectTrigger aria-labelledby={`${yearHeadingId} ${yearHeadingId}-value`}>
              <SelectValue id={`${yearHeadingId}-value`} />
            </SelectTrigger>
            <SelectContent>
              {YEAR_OPTIONS.map((y) => (
                <SelectItem key={y} value={y}>
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
