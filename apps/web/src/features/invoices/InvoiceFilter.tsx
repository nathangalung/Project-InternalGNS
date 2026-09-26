import { useId, useState } from "react"
import { IconCalendar } from "@/components/document/icons"
import {
  DATE_PRESETS,
  DateInput,
  type DatePreset,
  presetToIsoRange,
} from "@/components/shared/DateRangeField"
import FilterFooter from "@/components/shared/FilterFooter"
import Modal from "@/components/shared/Modal"
import { chip, presetChip, ui } from "@/lib/ui"
import type { InvoiceStatus } from "./types"
import { INVOICE_LABEL } from "./types"

export type { DatePreset }

export type InvoiceFilterValues = {
  createdPreset: DatePreset
  createdStart: string
  createdEnd: string
  duePreset: DatePreset
  dueStart: string
  dueEnd: string
  statuses: InvoiceStatus[]
  minHarga: string
  maxHarga: string
}

type InvoiceFilterProps = {
  onClose: () => void
  onApply: (filters: InvoiceFilterValues) => void
  initialValues?: InvoiceFilterValues
}

const seed = presetToIsoRange("30-hari")
const DEFAULTS: InvoiceFilterValues = {
  createdPreset: "semua",
  createdStart: seed.start,
  createdEnd: seed.end,
  duePreset: "semua",
  dueStart: seed.start,
  dueEnd: seed.end,
  statuses: [],
  minHarga: "",
  maxHarga: "",
}

const STATUS_OPTIONS: InvoiceStatus[] = ["DRAF", "DIKIRIM", "DIBAYAR", "TERLAMBAT"]

type DateRangeBlockProps = {
  heading: string
  preset: DatePreset
  startDate: string
  endDate: string
  onChange: (next: { preset: DatePreset; startDate: string; endDate: string }) => void
}

function DateRangeBlock({ heading, preset, startDate, endDate, onChange }: DateRangeBlockProps) {
  function pick(p: DatePreset) {
    if (p === "kustom") {
      onChange({ preset: "kustom", startDate, endDate })
      return
    }
    const r = presetToIsoRange(p)
    onChange({ preset: p, startDate: r.start, endDate: r.end })
  }

  return (
    <div className={ui.modalSection}>
      <div className={ui.modalSectionHeading}>{heading}</div>
      <div className={ui.field}>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,13rem),1fr))] gap-2">
          {DATE_PRESETS.map(({ key, label }) => {
            const isActive = preset === key
            return (
              <button
                key={key}
                type="button"
                onClick={() => pick(key)}
                aria-pressed={isActive}
                className={presetChip(isActive)}
              >
                {label}
                {key === "kustom" ? (
                  <span className={isActive ? "text-primary-700" : "text-[#9CA3AF]"}>
                    <IconCalendar />
                  </span>
                ) : isActive ? (
                  <svg aria-hidden="true" width="14" height="11" viewBox="0 0 14 11" fill="none">
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
          onChange={(v) => onChange({ preset: "kustom", startDate: v, endDate })}
        />
        <DateInput
          label="Tanggal Selesai"
          value={endDate}
          onChange={(v) => onChange({ preset: "kustom", startDate, endDate: v })}
        />
      </div>
    </div>
  )
}

export default function InvoiceFilter({ onClose, onApply, initialValues }: InvoiceFilterProps) {
  const [createdPreset, setCreatedPreset] = useState<DatePreset>(
    initialValues?.createdPreset ?? DEFAULTS.createdPreset,
  )
  const [createdStart, setCreatedStart] = useState<string>(
    initialValues?.createdStart ?? DEFAULTS.createdStart,
  )
  const [createdEnd, setCreatedEnd] = useState<string>(
    initialValues?.createdEnd ?? DEFAULTS.createdEnd,
  )
  const [duePreset, setDuePreset] = useState<DatePreset>(
    initialValues?.duePreset ?? DEFAULTS.duePreset,
  )
  const [dueStart, setDueStart] = useState<string>(initialValues?.dueStart ?? DEFAULTS.dueStart)
  const [dueEnd, setDueEnd] = useState<string>(initialValues?.dueEnd ?? DEFAULTS.dueEnd)
  const [activeStatuses, setActiveStatuses] = useState<InvoiceStatus[]>(
    initialValues?.statuses ?? DEFAULTS.statuses,
  )
  const fieldId = useId()
  const [minHarga, setMinHarga] = useState(initialValues?.minHarga ?? DEFAULTS.minHarga)
  const [maxHarga, setMaxHarga] = useState(initialValues?.maxHarga ?? DEFAULTS.maxHarga)

  const dirty =
    createdPreset !== DEFAULTS.createdPreset ||
    createdStart !== DEFAULTS.createdStart ||
    createdEnd !== DEFAULTS.createdEnd ||
    duePreset !== DEFAULTS.duePreset ||
    dueStart !== DEFAULTS.dueStart ||
    dueEnd !== DEFAULTS.dueEnd ||
    activeStatuses.length > 0 ||
    minHarga !== DEFAULTS.minHarga ||
    maxHarga !== DEFAULTS.maxHarga

  const toggleStatus = (s: InvoiceStatus) =>
    setActiveStatuses((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]))

  const handleReset = () => {
    setCreatedPreset(DEFAULTS.createdPreset)
    setCreatedStart(DEFAULTS.createdStart)
    setCreatedEnd(DEFAULTS.createdEnd)
    setDuePreset(DEFAULTS.duePreset)
    setDueStart(DEFAULTS.dueStart)
    setDueEnd(DEFAULTS.dueEnd)
    setActiveStatuses([])
    setMinHarga(DEFAULTS.minHarga)
    setMaxHarga(DEFAULTS.maxHarga)
  }

  const handleApply = () => {
    onApply({
      createdPreset,
      createdStart,
      createdEnd,
      duePreset,
      dueStart,
      dueEnd,
      statuses: activeStatuses,
      minHarga,
      maxHarga,
    })
    onClose()
  }

  return (
    <Modal
      title="Filter Invoice"
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
      <DateRangeBlock
        heading="Rentang Tanggal Pembuatan"
        preset={createdPreset}
        startDate={createdStart}
        endDate={createdEnd}
        onChange={({ preset, startDate, endDate }) => {
          setCreatedPreset(preset)
          setCreatedStart(startDate)
          setCreatedEnd(endDate)
        }}
      />
      <DateRangeBlock
        heading="Rentang Tanggal Jatuh Tempo"
        preset={duePreset}
        startDate={dueStart}
        endDate={dueEnd}
        onChange={({ preset, startDate, endDate }) => {
          setDuePreset(preset)
          setDueStart(startDate)
          setDueEnd(endDate)
        }}
      />

      <div className={ui.modalSection}>
        <div className={ui.modalSectionHeading}>Rentang Total Tagihan</div>
        <div className={ui.row2}>
          {[
            { id: `${fieldId}-min`, label: "Min Total", value: minHarga, set: setMinHarga },
            { id: `${fieldId}-max`, label: "Max Total", value: maxHarga, set: setMaxHarga },
          ].map(({ id, label, value, set }) => (
            <div className={ui.field} key={id}>
              <label htmlFor={id} className={ui.fieldLabel}>
                {label}
              </label>
              <div className={ui.prefixWrap}>
                <span className={ui.prefixLabel}>IDR</span>
                <input
                  id={id}
                  className={ui.prefixInput}
                  type="text"
                  inputMode="numeric"
                  value={value}
                  onChange={(e) => set(e.target.value)}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className={ui.modalSection}>
        <div className={ui.modalSectionHeading}>Status Invoice</div>
        <div className={ui.field}>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setActiveStatuses([])}
              aria-pressed={activeStatuses.length === 0}
              className={chip(activeStatuses.length === 0)}
            >
              Semua
            </button>
            {STATUS_OPTIONS.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => toggleStatus(value)}
                aria-pressed={activeStatuses.includes(value)}
                className={chip(activeStatuses.includes(value))}
              >
                {INVOICE_LABEL[value]}
              </button>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  )
}
