import type { Status } from "@/features/quotations/types"
import { quotationStatusConfig } from "@/lib/status"

// Re-exported for legacy callers.
export const statusConfig: Record<Status, { bg: string; color: string }> = quotationStatusConfig

export interface QuotationRow {
  id: string
  displayNo: string
  version: number
  client: string
  date: string
  hargaBeli: string
  total: string
  status: Status
}

// Pagination ellipsis placeholder.
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
