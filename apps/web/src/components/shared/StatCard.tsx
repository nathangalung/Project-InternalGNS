import type { KeyboardEvent, ReactNode } from "react"
import { ui } from "@/lib/ui"

export type StatTone = "neutral" | "violet" | "blue" | "green" | "gold" | "red"

type StatCardProps = {
  label: string
  value: ReactNode
  tone?: StatTone
  onClick?: () => void
}

// Surface, accent and text per tone.
//
// Tinted labels sit at 85% of the value colour, enough for 4.5:1 at 12px.
// Tinted cards have no border, so 25px padding matches the neutral card
// border plus padding and every tone is the same height.
const tones: Record<
  StatTone,
  { card: string; overlay?: string; glow?: string; label: string; value: string }
> = {
  neutral: {
    card: "border border-dark-200 bg-white p-6 shadow-sm",
    label: "text-dark-500",
    value: "text-dark-900",
  },
  violet: {
    card: "p-[25px] bg-[linear-gradient(135deg,var(--color-primary-900)_0%,var(--color-primary-700)_50%,var(--color-primary-500)_100%)]",
    label: "text-white/85",
    value: "text-white",
  },
  blue: {
    card: "p-[25px] bg-white",
    overlay: "bg-[linear-gradient(82.48deg,rgba(63,86,255,0.5)_6.42%,#DBEAFE_93.58%)] opacity-50",
    label: "text-[rgba(35,29,216,0.85)]",
    value: "text-[#231DD8]",
  },
  green: {
    card: "p-[25px] bg-[rgba(16,185,129,0.05)]",
    glow: "bg-[rgba(52,211,153,0.2)]",
    label: "text-[rgba(6,78,59,0.85)]",
    value: "text-[#064E3B]",
  },
  gold: {
    card: "p-[25px] bg-white",
    overlay:
      "bg-[linear-gradient(82.48deg,rgba(217,119,6,0.5)_6.42%,rgba(245,158,11,0.1)_93.58%)] opacity-50",
    label: "text-[rgba(120,53,15,0.85)]",
    value: "text-[#78350F]",
  },
  red: {
    card: "p-[25px] bg-[rgba(220,38,38,0.05)]",
    glow: "bg-[rgba(239,94,94,0.2)]",
    label: "text-[rgba(127,29,29,0.85)]",
    value: "text-[#7F1D1D]",
  },
}

// One KPI card for every screen.
//
// Dashboards and list pages share the same scale: 24px padding, a 12px
// uppercase label and a 20px value. Tone only changes the surface colour.
export default function StatCard({ label, value, tone = "neutral", onClick }: StatCardProps) {
  const t = tones[tone]
  const interactive = onClick
    ? {
        onClick,
        role: "button" as const,
        tabIndex: 0,
        onKeyDown: (e: KeyboardEvent) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            onClick()
          }
        },
      }
    : {}
  return (
    <div
      className={`relative overflow-hidden rounded-xl transition ${t.card} ${
        onClick
          ? `cursor-pointer hover:border-primary-200 hover:shadow-md motion-safe:hover:-translate-y-0.5 ${ui.focusRing}`
          : ""
      }`}
      {...interactive}
    >
      {t.overlay && (
        <div className={`pointer-events-none absolute inset-0 rounded-xl ${t.overlay}`} />
      )}
      {t.glow && (
        <div
          className={`pointer-events-none absolute -bottom-10 -left-10 h-32 w-32 rounded-lg blur-[32px] ${t.glow}`}
        />
      )}
      <div className={`relative text-caption font-semibold uppercase tracking-[0.05em] ${t.label}`}>
        {label}
      </div>
      <div className={`relative mt-2 text-xl font-bold ${t.value}`}>{value}</div>
    </div>
  )
}
