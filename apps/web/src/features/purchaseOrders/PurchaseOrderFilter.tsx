import { useState } from "react"
import { IconCalendar } from "@/components/document/icons"
import {
  DATE_PRESETS,
  DateInput,
  type DatePreset,
  presetToIsoRange,
} from "@/components/shared/DateRangeField"
import { chipStyle, presetChipStyle } from "@/components/shared/filter-styles"
import { PO_LABEL, PO_STATUS_ORDER } from "./PurchaseOrderDetail/helpers"
import type { PoStatus } from "./types"

export type { DatePreset }

export interface PoFilterValues {
  preset: DatePreset
  startDate: string
  endDate: string
  statuses: PoStatus[]
  minHarga: string
  maxHarga: string
}

interface PurchaseOrderFilterProps {
  onClose: () => void
  onApply: (filters: PoFilterValues) => void
  initialValues?: PoFilterValues
}

const seed = presetToIsoRange("30-hari")
const DEFAULTS: PoFilterValues = {
  preset: "semua",
  startDate: seed.start,
  endDate: seed.end,
  statuses: [],
  minHarga: "",
  maxHarga: "",
}

// Labels from PO_LABEL match the badges.
const STATUS_OPTIONS: { value: PoStatus; label: string }[] = PO_STATUS_ORDER.map((value) => ({
  value,
  label: PO_LABEL[value],
}))

export default function PurchaseOrderFilter({
  onClose,
  onApply,
  initialValues,
}: PurchaseOrderFilterProps) {
  const [preset, setPreset] = useState<DatePreset>(initialValues?.preset ?? DEFAULTS.preset)
  const [startDate, setStartDate] = useState<string>(initialValues?.startDate ?? DEFAULTS.startDate)
  const [endDate, setEndDate] = useState<string>(initialValues?.endDate ?? DEFAULTS.endDate)
  const [activeStatuses, setActiveStatuses] = useState<PoStatus[]>(
    initialValues?.statuses ?? DEFAULTS.statuses,
  )
  const [minHarga, setMinHarga] = useState(initialValues?.minHarga ?? DEFAULTS.minHarga)
  const [maxHarga, setMaxHarga] = useState(initialValues?.maxHarga ?? DEFAULTS.maxHarga)

  const dirty =
    preset !== DEFAULTS.preset ||
    startDate !== DEFAULTS.startDate ||
    endDate !== DEFAULTS.endDate ||
    activeStatuses.length > 0 ||
    minHarga !== DEFAULTS.minHarga ||
    maxHarga !== DEFAULTS.maxHarga

  function handlePresetClick(next: DatePreset) {
    setPreset(next)
    if (next !== "kustom") {
      const range = presetToIsoRange(next)
      setStartDate(range.start)
      setEndDate(range.end)
    }
  }

  function handleStartChange(v: string) {
    setStartDate(v)
    setPreset("kustom")
  }
  function handleEndChange(v: string) {
    setEndDate(v)
    setPreset("kustom")
  }

  const toggleStatus = (s: PoStatus) =>
    setActiveStatuses((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]))

  const handleReset = () => {
    setPreset(DEFAULTS.preset)
    setStartDate(DEFAULTS.startDate)
    setEndDate(DEFAULTS.endDate)
    setActiveStatuses([])
    setMinHarga(DEFAULTS.minHarga)
    setMaxHarga(DEFAULTS.maxHarga)
  }

  const handleApply = () => {
    onApply({ preset, startDate, endDate, statuses: activeStatuses, minHarga, maxHarga })
    onClose()
  }

  return (
    <div className="ca-overlay" onClick={onClose}>
      <div className="ca-modal" onClick={(e) => e.stopPropagation()}>
        <div className="ca-header">
          <h2 className="ca-title">Filter Purchase Order</h2>
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
            <div className="ca-section-heading">Rentang Tanggal</div>
            <div className="ca-field">
              <div className="rgrid-2 grid gap-2">
                {DATE_PRESETS.map(({ key, label }) => {
                  const isActive = preset === key
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => handlePresetClick(key)}
                      style={presetChipStyle(isActive)}
                    >
                      {label}
                      {key === "kustom" ? (
                        <span className={isActive ? "text-[#630ED4]" : "text-[#9CA3AF]"}>
                          <IconCalendar />
                        </span>
                      ) : isActive ? (
                        <svg width="14" height="11" viewBox="0 0 14 11" fill="none">
                          <path
                            d="M1 5.5L4.5 9L13 1"
                            stroke="#630ED4"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      ) : null}
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="ca-row-2">
              <DateInput label="Tanggal Mulai" value={startDate} onChange={handleStartChange} />
              <DateInput label="Tanggal Selesai" value={endDate} onChange={handleEndChange} />
            </div>
          </div>

          <div className="ca-section">
            <div className="ca-section-heading">Status Purchase Order</div>
            <div className="ca-field">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setActiveStatuses([])}
                  style={chipStyle(activeStatuses.length === 0)}
                >
                  Semua
                </button>
                {STATUS_OPTIONS.map(({ value, label }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => toggleStatus(value)}
                    style={chipStyle(activeStatuses.includes(value))}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="ca-section">
            <div className="ca-section-heading">Rentang Total PO</div>
            <div className="ca-row-2">
              {[
                { label: "Min Total", value: minHarga, set: setMinHarga },
                { label: "Max Total", value: maxHarga, set: setMaxHarga },
              ].map(({ label, value, set }) => (
                <div className="ca-field" key={label}>
                  <label className="ca-label">{label}</label>
                  <div className="ca-phone-wrapper">
                    <span className="ca-phone-prefix">IDR</span>
                    <input
                      className="ca-phone-input"
                      type="text"
                      value={value}
                      onChange={(e) => set(e.target.value)}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="ca-footer justify-between px-6 py-4">
          <button
            type="button"
            onClick={handleReset}
            disabled={!dirty}
            className={`p-0 text-[13px] font-medium underline-offset-[3px] ${
              dirty ? "cursor-pointer text-[#630ED4] underline" : "cursor-default text-dark-300"
            }`}
          >
            Hapus Filter
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              className="ca-btn-cancel px-[18px] py-2 text-[13px]"
              onClick={onClose}
            >
              Batal
            </button>
            <button
              type="button"
              className="ca-btn-submit px-[22px] py-2 text-[13px]"
              onClick={handleApply}
            >
              Terapkan
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
