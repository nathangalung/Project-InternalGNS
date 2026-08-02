import type { KeyboardEvent, ReactNode } from "react"

interface StatCardProps {
  label: string
  value: ReactNode
  onClick?: () => void
}

// Consistent KPI card. Refined off the legacy .stat-card: neutral hairline
// border and a soft shadow (the old one had a purple border and a heavy drop
// shadow), so a grid of them reads as one calm system.
export default function StatCard({ label, value, onClick }: StatCardProps) {
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
      className={`rounded-xl border border-dark-200 bg-white p-6 shadow-sm transition ${
        onClick
          ? "cursor-pointer hover:-translate-y-0.5 hover:border-primary-200 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-600/40"
          : ""
      }`}
      {...interactive}
    >
      <div className="text-caption font-semibold uppercase tracking-[0.05em] text-dark-500">
        {label}
      </div>
      <div className="mt-2 text-xl font-bold text-dark-900">{value}</div>
    </div>
  )
}
