// Pagination row size options.
export const PAGE_SIZE_OPTIONS = [5, 10, 15]

// Page numbers with ellipsis gaps.
//
// A null entry is an ellipsis placeholder.
export function getPageNumbers(current: number, total: number): (number | null)[] {
  if (total <= 5) return Array.from({ length: total }, (_, i) => i + 1)
  const set = new Set(
    [1, 2, current - 1, current, current + 1, total - 1, total].filter((n) => n >= 1 && n <= total),
  )
  const sorted = [...set].sort((a, b) => a - b)
  const pages: (number | null)[] = []
  let prev = 0
  for (const n of sorted) {
    if (n - prev > 1) pages.push(null)
    pages.push(n)
    prev = n
  }
  return pages
}

// Pages for a row count.
// Never zero, so an empty list still has page 1.
export function pageCount(rows: number, size: number): number {
  return Math.max(1, Math.ceil(rows / size))
}

// Page pulled into range.
//
// A list that shrank under the reader (a removed line, a narrowed filter)
// shows its new last page rather than an empty one.
export function clampPage(page: number, totalPages: number): number {
  return Math.min(Math.max(page, 1), Math.max(totalPages, 1))
}
