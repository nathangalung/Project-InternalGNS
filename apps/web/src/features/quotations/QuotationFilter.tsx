import { useState } from "react"
import { IconCalendar } from "@/components/document/icons"
import {
  DATE_PRESETS,
  DateInput,
  type DatePreset,
  presetToIsoRange,
} from "@/components/shared/DateRangeField"
import Modal from "@/components/shared/Modal"
import type { DisplayStatus } from "@/lib/status"
import { ui } from "@/lib/ui"

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

// Faithful port of the legacy ca-phone-wrapper/-prefix/-input trio.
const amountWrapper =
  "flex h-11 overflow-hidden rounded-md border-[1.5px] border-transparent bg-dark-200 transition-[border-color,box-shadow] duration-200 focus-within:border-primary-600 focus-within:shadow-[0_0_0_3px_rgba(124,58,237,0.12)]"
const amountPrefix =
  "flex items-center whitespace-nowrap border-r border-dark-300 px-3 text-sm font-medium text-dark-600"
const amountInput =
  "min-w-0 flex-1 border-none bg-transparent px-3 text-sm text-dark-900 outline-none placeholder:text-dark-500"

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
    <Modal
      title="Filter Quotation"
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            onClick={handleReset}
            disabled={!dirty}
            className={`mr-auto p-0 text-[13px] font-medium underline-offset-[3px] ${
              dirty ? "cursor-pointer text-[#630ED4] underline" : "cursor-default text-dark-300"
            }`}
          >
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
      {/* Rentang Tanggal */}
      <div className={ui.modalSection}>
        <div className={ui.modalSectionHeading}>Rentang Tanggal</div>

        <div className={ui.field}>
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

        <div className={ui.row2}>
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
      <div className={ui.modalSection}>
        <div className={ui.modalSectionHeading}>Status Penawaran</div>
        <div className={ui.field}>
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
      <div className={ui.modalSection}>
        <div className={ui.modalSectionHeading}>Rentang Total Penawaran</div>
        <div className={ui.row2}>
          {[
            { label: "Min Total", value: minHarga, set: setMinHarga },
            { label: "Max Total", value: maxHarga, set: setMaxHarga },
          ].map(({ label, value, set }) => (
            <div className={ui.field} key={label}>
              <label className={ui.fieldLabel}>{label}</label>
              <div className={amountWrapper}>
                <span className={amountPrefix}>IDR</span>
                <input
                  className={amountInput}
                  type="text"
                  value={value}
                  onChange={(e) => set(e.target.value)}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  )
}
