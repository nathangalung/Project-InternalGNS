import type { CSSProperties, ReactNode } from "react"

interface StatusBadgeProps {
  bg: string
  color: string
  minWidth?: number
  children: ReactNode
}

export default function StatusBadge({ bg, color, minWidth, children }: StatusBadgeProps) {
  const style: CSSProperties = { background: bg, color }
  if (minWidth !== undefined) style.minWidth = minWidth
  return (
    <span className="status-badge" style={style}>
      {children}
    </span>
  )
}
