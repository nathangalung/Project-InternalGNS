import type { ReactNode } from "react"
import StatCard, { type StatTone } from "./StatCard"

type SummaryCardProps = {
  variant: Exclude<StatTone, "neutral">
  label: string
  value: ReactNode
}

// Tinted StatCard alias.
export default function SummaryCard({ variant, label, value }: SummaryCardProps) {
  return <StatCard tone={variant} label={label} value={value} />
}
