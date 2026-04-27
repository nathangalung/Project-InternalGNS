interface SearchBarProps {
  search: string;
  onSearch: (v: string) => void;
  onOpenFilter: () => void;
}

// Search input plus filter trigger.
export default function SearchBar({ search, onSearch, onOpenFilter }: SearchBarProps) {
  return (
    <div className="search-row">
      <div className="search-wrapper">
        <svg className="search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          type="text"
          className="search-input"
          placeholder="Cari penawaran, klien, atau nomor..."
          value={search}
          onChange={e => onSearch(e.target.value)}
        />
      </div>
      <button className="btn-admin-filter" onClick={onOpenFilter}>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="4" y1="6" x2="20" y2="6" />
          <line x1="7" y1="12" x2="17" y2="12" />
          <line x1="10" y1="18" x2="14" y2="18" />
        </svg>
        Filter
      </button>
    </div>
  );
}
