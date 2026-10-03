export type StatusFilterValue = "all" | "active" | "inactive"

export const STATUS_FILTER_OPTIONS: { value: StatusFilterValue; label: string }[] = [
  { value: "all", label: "Semua" },
  { value: "active", label: "Aktif" },
  { value: "inactive", label: "Nonaktif" },
]

const STATUS_FILTER_LABEL = Object.fromEntries(
  STATUS_FILTER_OPTIONS.map((o) => [o.value, o.label]),
) as Record<StatusFilterValue, string>

// Label of a status filter value.
export function statusFilterLabel(value: StatusFilterValue): string {
  return STATUS_FILTER_LABEL[value]
}
