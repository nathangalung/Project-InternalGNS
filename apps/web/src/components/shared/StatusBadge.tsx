import type { CSSProperties, ReactNode } from "react"

interface StatusBadgeProps {
  bg: string
  color: string
  minWidth?: number
  children: ReactNode
}

export default function StatusBadge({ bg, color, minWidth, children }: StatusBadgeProps) {
  // bg/color are status-driven (semantic), so they stay inline; the shape is
  // migrated to utilities.
  const style: CSSProperties = { background: bg, color, minWidth: minWidth ?? 90 }
  return (
    <span
      className="inline-flex items-center justify-center whitespace-nowrap rounded-full px-3 py-1 text-overline font-bold uppercase tracking-[0.05em]"
      style={style}
    >
      {children}
    </span>
  )
}
