import { useState } from "react"
import { IconCalendar } from "@/components/document/icons"
import {
  DATE_PRESETS,
  DateInput,
  type DatePreset,
  presetToIsoRange,
} from "@/components/shared/DateRangeField"
import type { DisplayStatus } from "@/lib/status"

export type { DatePreset }
export type StatusFilter = DisplayStatus

interface QuotationFilterProps {
  onClose: () => void
  onApply?: (filters: {
    preset: DatePreset
    startDate: string
    endDate: string
    statuses: StatusFilter[]
    minHarga: string
    maxHarga: string
  }) => void
  initialValues?: {
    preset: DatePreset
    startDate?: string
    endDate?: string
    statuses: StatusFilter[]
    minHarga: string
    maxHarga: string
  }
}

const STATUSES: StatusFilter[] = ["Draf", "Dikirim", "Ditolak", "Revisi", "Disetujui"]

const presetChip =
  "flex items-center justify-between rounded-md px-3.5 py-2.5 text-[13px] transition-all duration-150"
const statusChip = "rounded-[20px] px-4 py-1.5 text-[13px] transition-all duration-150"
const chipActive =
  "border-[1.5px] border-[#630ED4] bg-[rgba(99,14,212,0.05)] font-bold text-[#630ED4]"
const statusChipActive =
  "border-[1.5px] border-[#630ED4] bg-[rgba(99,14,212,0.07)] font-bold text-[#630ED4]"
const chipIdle = "border border-[rgba(204,195,216,0.4)] bg-[#F7F7F8] font-medium text-[#4A4455]"

export default function QuotationFilter({ onClose, onApply, initialValues }: QuotationFilterProps) {
  const seed = presetToIsoRange("30-hari")
  const [preset, setPreset] = useState<DatePreset>(initialValues?.preset ?? "semua")
  const [startDate, setStartDate] = useState<string>(initialValues?.startDate ?? seed.start)
  const [endDate, setEndDate] = useState<string>(initialValues?.endDate ?? seed.end)
  const [activeStatuses, setActiveStatuses] = useState<StatusFilter[]>(
    initialValues?.statuses ?? [],
  )
  const [minHarga, setMinHarga] = useState(initialValues?.minHarga ?? "")
  const [maxHarga, setMaxHarga] = useState(initialValues?.maxHarga ?? "")

  function pickPreset(p: DatePreset) {
    setPreset(p)
    if (p !== "kustom") {
      const r = presetToIsoRange(p)
      setStartDate(r.start)
      setEndDate(r.end)
    }
  }

  const toggleStatus = (s: StatusFilter) =>
    setActiveStatuses((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]))

  const dirty =
    preset !== "semua" || activeStatuses.length > 0 || minHarga !== "" || maxHarga !== ""

  const handleReset = () => {
    pickPreset("semua")
    setActiveStatuses([])
    setMinHarga("")
    setMaxHarga("")
  }

  const handleApply = () => {
    onApply?.({ preset, startDate, endDate, statuses: activeStatuses, minHarga, maxHarga })
    onClose()
  }

  return (
    <div className="ca-overlay" onClick={onClose}>
      <div className="ca-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="ca-header">
          <h2 className="ca-title">Filter Quotation</h2>
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

        {/* Body */}
        <div className="ca-body">
          {/* Rentang Tanggal */}
          <div className="ca-section">
            <div className="ca-section-heading">Rentang Tanggal</div>

            <div className="ca-field">
              <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,13rem),1fr))] gap-2">
                {DATE_PRESETS.map(({ key, label }) => {
                  const isActive = preset === key
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => pickPreset(key)}
                      className={`${presetChip} ${isActive ? chipActive : chipIdle}`}
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
              <DateInput
                label="Tanggal Mulai"
                value={startDate}
                onChange={(v) => {
                  setStartDate(v)
                  setPreset("kustom")
                }}
              />
              <DateInput
                label="Tanggal Selesai"
                value={endDate}
                onChange={(v) => {
                  setEndDate(v)
                  setPreset("kustom")
                }}
              />
            </div>
          </div>

          {/* Status Penawaran */}
          <div className="ca-section">
            <div className="ca-section-heading">Status Penawaran</div>
            <div className="ca-field">
              <div className="flex flex-wrap gap-2">
                {(() => {
                  const allActive = activeStatuses.length === 0
                  return (
                    <button
                      type="button"
                      onClick={() => setActiveStatuses([])}
                      className={`${statusChip} ${allActive ? statusChipActive : chipIdle}`}
                    >
                      Semua
                    </button>
                  )
                })()}
                {STATUSES.map((s) => {
                  const isActive = activeStatuses.includes(s)
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => toggleStatus(s)}
                      className={`${statusChip} ${isActive ? statusChipActive : chipIdle}`}
                    >
                      {s}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>

          {/* Rentang Total Penawaran */}
          <div className="ca-section">
            <div className="ca-section-heading">Rentang Total Penawaran</div>
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

        {/* Footer */}
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
