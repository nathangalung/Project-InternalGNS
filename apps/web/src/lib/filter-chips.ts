import type { FilterChip } from "@/components/shared/ActiveFilters"

// Active filter chips.
//
// One chip for the search term, then one for each labelled filter that is
// off its default, in the order of labels. Removing a filter chip resets
// that field alone; patch is the list's patchFilters, so the reader keeps
// their page.
export function filterChips<F extends object>(
  search: { term: string; clear: () => void },
  filters: F,
  defaults: F,
  labels: { [K in keyof F]?: (value: F[K]) => string },
  patch: (update: (prev: F) => F) => void,
): FilterChip[] {
  const out: FilterChip[] = []
  if (search.term) {
    out.push({ key: "q", label: `Cari: "${search.term}"`, onRemove: search.clear })
  }
  for (const key of Object.keys(labels) as (keyof F & string)[]) {
    const label = labels[key]
    if (!label || filters[key] === defaults[key]) continue
    out.push({
      key,
      label: label(filters[key]),
      onRemove: () => patch((prev) => ({ ...prev, [key]: defaults[key] })),
    })
  }
  return out
}
