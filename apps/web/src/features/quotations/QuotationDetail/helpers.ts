import type { CSSProperties } from "react"
import type { Status } from "@/features/quotations/types"
import { quotationStatusConfig } from "@/lib/status"

// Re-exported for legacy callers.
export const statusConfig: Record<Status, { bg: string; color: string }> = quotationStatusConfig

// Pagination row size options.
export const PAGE_SIZE_OPTIONS = [5, 10, 15]

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

// Format current time id-ID.
export function nowLabel(): string {
  return new Date()
    .toLocaleString("id-ID", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
    .replace(/\./g, " ")
    .replace(",", ",")
}

// Shared field label style.
export const fieldLabel: CSSProperties = {
  fontSize: "11px",
  color: "#6B7280",
  fontWeight: 600,
  textTransform: "uppercase",
  marginBottom: "4px",
}

// Shared field value style.
export const fieldValue: CSSProperties = {
  fontSize: "14px",
  fontWeight: 500,
  color: "#111827",
}
