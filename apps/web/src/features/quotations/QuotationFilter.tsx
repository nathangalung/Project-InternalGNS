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

export default function QuotationFilter({ onClose, onApply, initialValues }: QuotationFilterProps) {
  const seed = presetToIsoRange("30-hari")
  const [preset, setPreset] = useState<DatePreset>(initialValues?.preset ?? "30-hari")
  const [startDate, setStartDate] = useState<string>(initialValues?.startDate ?? seed.start)
  const [endDate, setEndDate] = useState<string>(initialValues?.endDate ?? seed.end)
  const [activeStatuses, setActiveStatuses] = useState<StatusFilter[]>(
    initialValues?.statuses ?? [],
  )
  const [minHarga, setMinHarga] = useState(initialValues?.minHarga ?? "0")
  const [maxHarga, setMaxHarga] = useState(initialValues?.maxHarga ?? "500.000.000")

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
    preset !== "30-hari" ||
    startDate !== seed.start ||
    endDate !== seed.end ||
    activeStatuses.length > 0 ||
    minHarga !== "0" ||
    maxHarga !== "500.000.000"

  const handleReset = () => {
    pickPreset("30-hari")
    setActiveStatuses([])
    setMinHarga("0")
    setMaxHarga("500.000.000")
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
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                {DATE_PRESETS.map(({ key, label }) => {
                  const isActive = preset === key
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => pickPreset(key)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "10px 14px",
                        borderRadius: "8px",
                        border: isActive
                          ? "1.5px solid #630ED4"
                          : "1px solid rgba(204, 195, 216, 0.4)",
                        background: isActive ? "rgba(99, 14, 212, 0.05)" : "#F7F7F8",
                        cursor: "pointer",
                        fontFamily: "'Inter', sans-serif",
                        fontWeight: isActive ? 700 : 500,
                        fontSize: "13px",
                        color: isActive ? "#630ED4" : "#4A4455",
                        transition: "all 0.15s",
                      }}
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
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                {(() => {
                  const allActive = activeStatuses.length === 0
                  return (
                    <button
                      type="button"
                      onClick={() => setActiveStatuses([])}
                      style={{
                        padding: "6px 16px",
                        borderRadius: "20px",
                        border: allActive
                          ? "1.5px solid #630ED4"
                          : "1px solid rgba(204, 195, 216, 0.4)",
                        background: allActive ? "rgba(99, 14, 212, 0.07)" : "#F7F7F8",
                        cursor: "pointer",
                        fontFamily: "'Inter', sans-serif",
                        fontWeight: allActive ? 700 : 500,
                        fontSize: "13px",
                        color: allActive ? "#630ED4" : "#4A4455",
                        transition: "all 0.15s",
                      }}
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
                      style={{
                        padding: "6px 16px",
                        borderRadius: "20px",
                        border: isActive
                          ? "1.5px solid #630ED4"
                          : "1px solid rgba(204, 195, 216, 0.4)",
                        background: isActive ? "rgba(99, 14, 212, 0.07)" : "#F7F7F8",
                        cursor: "pointer",
                        fontFamily: "'Inter', sans-serif",
                        fontWeight: isActive ? 700 : 500,
                        fontSize: "13px",
                        color: isActive ? "#630ED4" : "#4A4455",
                        transition: "all 0.15s",
                      }}
                    >
                      {s}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>

          {/* Rentang Harga */}
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
        </div>

        {/* Footer */}
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
