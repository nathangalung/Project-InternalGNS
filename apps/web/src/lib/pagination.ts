// Pagination row size options.
export const PAGE_SIZE_OPTIONS = [5, 10, 15]

// Build page-number list with ellipsis placeholders (null).
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
