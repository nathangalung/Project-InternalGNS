import type { Status } from "@/features/quotations/types"
import { quotationStatusConfig } from "@/lib/status"

export const statusConfig: Record<Status, { bg: string; color: string }> = quotationStatusConfig

// Columns the table header can sort.
export type SortableRowKey = "displayNo" | "version" | "date" | "total"

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
