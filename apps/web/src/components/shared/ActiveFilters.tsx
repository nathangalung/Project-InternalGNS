export type FilterChip = { key: string; label: string; onRemove?: () => void }

interface ActiveFiltersProps {
  chips: FilterChip[]
  onClearAll?: () => void
}

// Shows the filters currently applied to a list, above the table.
export default function ActiveFilters({ chips, onClearAll }: ActiveFiltersProps) {
  if (chips.length === 0) return null
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <span className="text-[13px] font-medium text-[#6B7280]">Filter aktif:</span>
      {chips.map((c) => (
        <span
          key={c.key}
          className="inline-flex items-center gap-1.5 rounded-xl border border-[rgba(99,14,212,0.2)] bg-[rgba(99,14,212,0.07)] px-2.5 py-1 text-[12px] font-medium text-primary-700"
        >
          {c.label}
          {c.onRemove && (
            <button
              type="button"
              onClick={c.onRemove}
              aria-label={`Hapus filter ${c.label}`}
              className="p-0 text-[15px] leading-none text-primary-700"
            >
              ×
            </button>
          )}
        </span>
      ))}
      {onClearAll && (
        <button
          type="button"
          onClick={onClearAll}
          className="p-0 text-[12px] text-[#6B7280] underline underline-offset-2"
        >
          Hapus semua
        </button>
      )}
    </div>
  )
}
