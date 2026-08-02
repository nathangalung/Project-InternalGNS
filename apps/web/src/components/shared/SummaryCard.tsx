import type { ReactNode } from "react"

type Variant = "violet" | "blue" | "green" | "gold" | "red"

// Faithful port of the legacy .card-violet/.card-blue/.card-green/.card-gold
// list KPI cards: gradient/tinted surfaces with an overlay or glow accent.
const variants: Record<
  Variant,
  { card: string; overlay?: string; glow?: string; label: string; value: string }
> = {
  violet: {
    card: "bg-[linear-gradient(135deg,var(--color-primary-900)_0%,var(--color-primary-700)_50%,var(--color-primary-500)_100%)]",
    label: "text-white/70",
    value: "text-white",
  },
  blue: {
    card: "bg-white",
    overlay: "bg-[linear-gradient(82.48deg,rgba(63,86,255,0.5)_6.42%,#DBEAFE_93.58%)] opacity-50",
    label: "text-[rgba(35,29,216,0.6)]",
    value: "text-[#231DD8]",
  },
  green: {
    card: "bg-[rgba(16,185,129,0.05)]",
    glow: "bg-[rgba(52,211,153,0.2)]",
    label: "text-[rgba(6,78,59,0.6)]",
    value: "text-[#064E3B]",
  },
  gold: {
    card: "bg-white",
    overlay:
      "bg-[linear-gradient(82.48deg,rgba(217,119,6,0.5)_6.42%,rgba(245,158,11,0.1)_93.58%)] opacity-50",
    label: "text-[rgba(120,53,15,0.6)]",
    value: "text-[#78350F]",
  },
  red: {
    card: "bg-[rgba(220,38,38,0.05)]",
    glow: "bg-[rgba(239,94,94,0.2)]",
    label: "text-[rgba(127,29,29,0.6)]",
    value: "text-[#7F1D1D]",
  },
}

interface SummaryCardProps {
  variant: Variant
  label: string
  value: ReactNode
}

export default function SummaryCard({ variant, label, value }: SummaryCardProps) {
  const v = variants[variant]
  return (
    <div
      className={`relative flex flex-col justify-start gap-1 overflow-hidden rounded-xl p-6 ${v.card}`}
    >
      {v.overlay && (
        <div className={`pointer-events-none absolute inset-0 z-0 rounded-xl ${v.overlay}`} />
      )}
      {v.glow && (
        <div
          className={`pointer-events-none absolute -bottom-10 -left-10 z-0 h-32 w-32 rounded-lg blur-[32px] ${v.glow}`}
        />
      )}
      <div
        className={`relative z-[1] text-sm font-semibold uppercase tracking-[0.05em] ${v.label}`}
      >
        {label}
      </div>
      <div className={`relative z-[1] text-3xl font-bold ${v.value}`}>{value}</div>
    </div>
  )
}
