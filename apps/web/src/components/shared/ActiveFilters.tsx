export type FilterChip = { key: string; label: string; onRemove?: () => void }

interface ActiveFiltersProps {
  chips: FilterChip[]
  onClearAll?: () => void
}

// Shows the filters currently applied to a list, above the table.
export default function ActiveFilters({ chips, onClearAll }: ActiveFiltersProps) {
  if (chips.length === 0) return null
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: "8px",
        marginBottom: "12px",
      }}
    >
      <span
        style={{
          fontFamily: "'Inter', sans-serif",
          fontSize: "13px",
          fontWeight: 500,
          color: "#6B7280",
        }}
      >
        Filter aktif:
      </span>
      {chips.map((c) => (
        <span
          key={c.key}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            padding: "4px 10px",
            borderRadius: "16px",
            background: "rgba(99, 14, 212, 0.07)",
            border: "1px solid rgba(99, 14, 212, 0.2)",
            fontFamily: "'Inter', sans-serif",
            fontSize: "12px",
            fontWeight: 500,
            color: "#630ED4",
          }}
        >
          {c.label}
          {c.onRemove && (
            <button
              type="button"
              onClick={c.onRemove}
              aria-label={`Hapus filter ${c.label}`}
              style={{
                border: "none",
                background: "transparent",
                cursor: "pointer",
                color: "#630ED4",
                lineHeight: 1,
                padding: 0,
                fontSize: "15px",
              }}
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
          style={{
            border: "none",
            background: "transparent",
            cursor: "pointer",
            fontFamily: "'Inter', sans-serif",
            fontSize: "12px",
            color: "#6B7280",
            textDecoration: "underline",
            textUnderlineOffset: "2px",
            padding: 0,
          }}
        >
          Hapus semua
        </button>
      )}
    </div>
  )
}
