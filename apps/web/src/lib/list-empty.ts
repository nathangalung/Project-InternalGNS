// List empty-state text.
//
// "Belum ada …" reads as if nothing exists, which is wrong when a search
// or a filter hides the rows; then the text names what narrowed the list.
export function emptyListText(
  list: { debouncedSearch: string; narrowed: boolean },
  empty: string,
): string {
  if (list.debouncedSearch) return `Tidak ada hasil untuk "${list.debouncedSearch}".`
  if (list.narrowed) return "Tidak ada hasil untuk filter ini."
  return empty
}
