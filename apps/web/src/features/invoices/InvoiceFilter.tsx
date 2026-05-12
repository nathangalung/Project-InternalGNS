import { type CSSProperties, useState } from "react"
import {
  DATE_PRESETS,
  DateInput,
  type DatePreset,
  presetToIsoRange,
} from "@/components/shared/DateRangeField"
import type { InvoiceStatus } from "./types"
import { INVOICE_LABEL } from "./types"

export type { DatePreset }

export interface InvoiceFilterValues {
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

interface InvoiceFilterProps {
  onClose: () => void
  onApply: (filters: InvoiceFilterValues) => void
  initialValues?: InvoiceFilterValues
}

const seed = presetToIsoRange("30-hari")
const DEFAULTS: InvoiceFilterValues = {
  createdPreset: "30-hari",
  createdStart: seed.start,
  createdEnd: seed.end,
  duePreset: "30-hari",
  dueStart: seed.start,
  dueEnd: seed.end,
  statuses: [],
  minHarga: "0",
  maxHarga: "500.000.000",
}

const STATUS_OPTIONS: InvoiceStatus[] = ["DRAF", "DIKIRIM", "DIBAYAR", "TERLAMBAT"]

function chipStyle(active: boolean): CSSProperties {
  return {
    padding: "8px 18px",
    borderRadius: "999px",
    border: active ? "1.5px solid #630ED4" : "1px solid #E5E7EB",
    background: active ? "rgba(99, 14, 212, 0.06)" : "#FFFFFF",
    cursor: "pointer",
    fontFamily: "'Inter', sans-serif",
    fontWeight: active ? 600 : 500,
    fontSize: "13px",
    color: active ? "#630ED4" : "#4A4455",
    transition: "all 0.15s",
  }
}

function presetChipStyle(active: boolean): CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "10px 14px",
    borderRadius: "8px",
    border: active ? "1.5px solid #630ED4" : "1px solid #E5E7EB",
    background: active ? "rgba(99, 14, 212, 0.06)" : "#FFFFFF",
    cursor: "pointer",
    fontFamily: "'Inter', sans-serif",
    fontWeight: active ? 600 : 500,
    fontSize: "13px",
    color: active ? "#630ED4" : "#4A4455",
    transition: "all 0.15s",
  }
}

function IconCalendar() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  )
}

interface DateRangeBlockProps {
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
    <div className="ca-section">
      <div className="ca-section-heading">{heading}</div>
      <div className="ca-field">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
          {DATE_PRESETS.map(({ key, label }) => {
            const isActive = preset === key
            return (
              <button
                key={key}
                type="button"
                onClick={() => pick(key)}
                style={presetChipStyle(isActive)}
              >
                {label}
                {key === "kustom" ? (
                  <span style={{ color: isActive ? "#630ED4" : "#9CA3AF" }}>
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
    <div className="ca-overlay" onClick={onClose}>
      <div className="ca-modal" onClick={(e) => e.stopPropagation()}>
        <div className="ca-header">
          <h2 className="ca-title">Filter Invoice</h2>
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

          <div className="ca-section">
            <div className="ca-section-heading">Rentang Harga</div>
            <div className="ca-row-2">
              {[
                { label: "Min Harga", value: minHarga, set: setMinHarga },
                { label: "Max Harga", value: maxHarga, set: setMaxHarga },
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

          <div className="ca-section">
            <div className="ca-section-heading">Status Invoice</div>
            <div className="ca-field">
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                <button
                  type="button"
                  onClick={() => setActiveStatuses([])}
                  style={chipStyle(activeStatuses.length === 0)}
                >
                  Semua
                </button>
                {STATUS_OPTIONS.map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => toggleStatus(value)}
                    style={chipStyle(activeStatuses.includes(value))}
                  >
                    {INVOICE_LABEL[value]}
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
