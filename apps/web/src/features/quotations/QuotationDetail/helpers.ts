import type { Status } from "@/features/quotations/types"
import { quotationStatusConfig } from "@/lib/status"

export { getPageNumbers, PAGE_SIZE_OPTIONS } from "@/lib/pagination"

// Re-exported for legacy callers.
export const statusConfig: Record<Status, { bg: string; color: string }> = quotationStatusConfig

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
