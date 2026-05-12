import type { Status } from "@/features/quotations/types"
import { quotationStatusConfig } from "@/lib/status"

export { getPageNumbers } from "@/lib/pagination"

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
