import { ui } from "@/lib/ui"

interface FilterButtonProps {
  onClick: () => void
  label?: string
}

export default function FilterButton({ onClick, label = "Filter" }: FilterButtonProps) {
  return (
    <button className={ui.btnPrimary} onClick={onClick} type="button">
      <svg
        viewBox="0 0 24 24"
        width="16"
        height="16"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <line x1="4" y1="6" x2="20" y2="6" />
        <line x1="7" y1="12" x2="17" y2="12" />
        <line x1="10" y1="18" x2="14" y2="18" />
      </svg>
      {label}
    </button>
  )
}
