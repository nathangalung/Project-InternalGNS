import { ui } from "@/lib/ui"

interface SearchInputProps {
  value: string
  onChange: (next: string) => void
  placeholder: string
}

export default function SearchInput({ value, onChange, placeholder }: SearchInputProps) {
  return (
    <div className="relative flex-1">
      <svg
        className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#94A3B8"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
      <input
        type="text"
        className={ui.searchInput}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}
