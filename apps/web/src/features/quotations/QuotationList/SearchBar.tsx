import FilterButton from "@/components/shared/FilterButton"

interface SearchBarProps {
  search: string
  onSearch: (v: string) => void
  onOpenFilter: () => void
}

// Search input plus filter trigger.
export default function SearchBar({ search, onSearch, onOpenFilter }: SearchBarProps) {
  return (
    <div className="search-row">
      <div className="search-wrapper">
        <svg
          className="search-icon"
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
          className="search-input"
          placeholder="Cari penawaran, klien, atau nomor..."
          value={search}
          onChange={(e) => onSearch(e.target.value)}
        />
      </div>
      <FilterButton onClick={onOpenFilter} />
    </div>
  )
}
