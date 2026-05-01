import type { CSSProperties } from "react"

export type DatePreset = "hari-ini" | "7-hari" | "30-hari" | "kustom"

export const DATE_PRESETS: { key: DatePreset; label: string }[] = [
  { key: "hari-ini", label: "Hari Ini" },
  { key: "7-hari",   label: "7 Hari Terakhir" },
  { key: "30-hari",  label: "30 Hari Terakhir" },
  { key: "kustom",   label: "Kustom" },
]

// Convert Date -> "YYYY-MM-DD" (local timezone, what <input type="date"> expects).
export function toIsoDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${dd}`
}

export function presetToIsoRange(preset: DatePreset): { start: string; end: string } {
  const today = new Date()
  const end = toIsoDate(today)
  if (preset === "hari-ini") return { start: end, end }
  const start = new Date(today)
  if (preset === "7-hari")  start.setDate(today.getDate() - 7)
  if (preset === "30-hari") start.setDate(today.getDate() - 30)
  // For "kustom" we still seed with the 30-day window as a sensible default.
  if (preset === "kustom")  start.setDate(today.getDate() - 30)
  return { start: toIsoDate(start), end }
}

interface DateInputProps {
  value: string
  onChange: (next: string) => void
  label: string
}

const labelStyle: CSSProperties = {
  fontFamily: "'Inter', sans-serif",
  fontWeight: 500,
  fontSize: "11px",
  color: "#9CA3AF",
  display: "block",
  marginBottom: "4px",
  letterSpacing: "0.2px",
}

const inputWrapStyle: CSSProperties = {
  position: "relative",
}

const inputStyle: CSSProperties = {
  width: "100%",
  height: "44px",
  padding: "10px 14px 10px 40px",
  fontFamily: "'Inter', sans-serif",
  fontSize: "13px",
  fontWeight: 500,
  color: "#191C1E",
  background: "#F7F7F8",
  border: "1px solid rgba(204, 195, 216, 0.4)",
  borderRadius: "8px",
  outline: "none",
  cursor: "pointer",
  boxSizing: "border-box",
  appearance: "none",
  WebkitAppearance: "none",
}

const iconStyle: CSSProperties = {
  position: "absolute",
  left: "14px",
  top: "50%",
  transform: "translateY(-50%)",
  color: "#9CA3AF",
  pointerEvents: "none",
}

// Single date <input type="date"> with calendar icon on the left.
export function DateInput({ value, onChange, label }: DateInputProps) {
  return (
    <div className="ca-field">
      <label className="ca-label" style={labelStyle}>{label}</label>
      <div style={inputWrapStyle}>
        <span style={iconStyle}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
        </span>
        <input
          type="date"
          className="shared-date-input"
          value={value}
          onChange={e => onChange(e.target.value)}
          style={inputStyle}
        />
      </div>
    </div>
  )
}
