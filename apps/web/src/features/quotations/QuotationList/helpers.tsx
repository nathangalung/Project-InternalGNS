import type { Status } from "@/features/quotations/types"
import { quotationBadge } from "../status"

// Badge colours, dashboard reuses.
export const statusConfig: Record<Status, { bg: string; color: string }> = quotationBadge

// Sortable table header columns.
export type SortableRowKey = "displayNo" | "version" | "date" | "total"

export type QuotationRow = {
  id: string
  displayNo: string
  version: number
  client: string
  date: string
  hargaBeli: string
  total: string
  status: Status
}
