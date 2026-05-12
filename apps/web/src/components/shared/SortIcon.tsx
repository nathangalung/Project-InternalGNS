interface SortIconProps {
  direction?: "asc" | "desc" | null
}

export default function SortIcon({ direction }: SortIconProps) {
  return (
    <svg width="6" height="10" viewBox="0 0 6 10" fill="none" style={{ flexShrink: 0 }}>
      <path d="M3 0L5.598 3.5H0.402L3 0Z" fill={direction === "asc" ? "#630ED4" : "#4A4455"} />
      <path d="M3 10L0.402 6.5H5.598L3 10Z" fill={direction === "desc" ? "#630ED4" : "#4A4455"} />
    </svg>
  )
}
