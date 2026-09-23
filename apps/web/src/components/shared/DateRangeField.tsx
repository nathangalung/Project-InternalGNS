import { ui } from "@/lib/ui"

export type DatePreset = "semua" | "hari-ini" | "7-hari" | "30-hari" | "kustom"

export const DATE_PRESETS: { key: DatePreset; label: string }[] = [
  { key: "semua", label: "Semua" },
  { key: "hari-ini", label: "Hari Ini" },
  { key: "7-hari", label: "7 Hari Terakhir" },
  { key: "30-hari", label: "30 Hari Terakhir" },
  { key: "kustom", label: "Kustom" },
]

// Date to local YYYY-MM-DD.
function toIsoDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${dd}`
}

export function presetToIsoRange(preset: DatePreset): { start: string; end: string } {
  if (preset === "semua") return { start: "", end: "" }
  const today = new Date()
  const end = toIsoDate(today)
  if (preset === "hari-ini") return { start: end, end }
  const start = new Date(today)
  if (preset === "7-hari") start.setDate(today.getDate() - 7)
  if (preset === "30-hari") start.setDate(today.getDate() - 30)
  // Kustom defaults to 30-day window.
  if (preset === "kustom") start.setDate(today.getDate() - 30)
  return { start: toIsoDate(start), end }
}

interface DateInputProps {
  value: string
  onChange: (next: string) => void
  label: string
}

const labelCls =
  "mb-1 block font-[Inter,sans-serif] text-[11px] font-medium tracking-[0.2px] text-[#9CA3AF]"

// Native picker hidden, whole field clickable.
const pickerCls =
  "[&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-0 [&::-webkit-calendar-picker-indicator]:h-full [&::-webkit-calendar-picker-indicator]:w-full [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-0 [&::-webkit-clear-button]:hidden [&::-webkit-inner-spin-button]:hidden"

const inputCls = `box-border h-11 w-full cursor-pointer appearance-none rounded-md border border-[rgba(204,195,216,0.4)] bg-[#F7F7F8] py-2.5 pr-3.5 pl-10 font-[Inter,sans-serif] text-[13px] font-medium text-[#191C1E] outline-none ${ui.fieldFocus} ${pickerCls}`

const iconCls =
  "pointer-events-none absolute top-1/2 left-3.5 [transform:translateY(-50%)] text-[#9CA3AF]"

// Date input with calendar icon.
export function DateInput({ value, onChange, label }: DateInputProps) {
  return (
    <div className="flex flex-col gap-2">
      <label className={labelCls}>{label}</label>
      <div className="relative">
        <span className={iconCls}>
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
        </span>
        <input
          type="date"
          className={inputCls}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    </div>
  )
}
