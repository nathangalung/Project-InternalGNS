import FilterButton from "@/components/shared/FilterButton"
import SearchInput from "@/components/shared/SearchInput"

interface SearchBarProps {
  search: string
  onSearch: (v: string) => void
  onOpenFilter: () => void
}

// Search input plus filter trigger.
export default function SearchBar({ search, onSearch, onOpenFilter }: SearchBarProps) {
  return (
    <div className="flex items-center gap-4 pt-2">
      <SearchInput
        value={search}
        onChange={onSearch}
        placeholder="Cari penawaran, klien, atau nomor..."
      />
      <FilterButton onClick={onOpenFilter} />
    </div>
  )
}
