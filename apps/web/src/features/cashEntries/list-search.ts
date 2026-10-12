import {
  compact,
  isoDay,
  type ListSchema,
  listSearchValidator,
  oneOf,
  trimmed,
} from "@/lib/list-search"
import type { CashDirection } from "@/types/api"
import { CASH_FILTERS, type CashFilterValues } from "./helpers"

// Filters as URL params.
export type CashFilterSearch = {
  direction?: CashDirection
  category?: string
  from?: string
  to?: string
}

const DIRECTIONS: readonly CashDirection[] = ["in", "out"]

// Search, filters and page.
export const cashListSchema: ListSchema<CashFilterValues, never, CashFilterSearch> = {
  filters: CASH_FILTERS,
  readFilters: (raw) => ({
    direction: oneOf(raw.direction, DIRECTIONS) ?? "all",
    category: trimmed(raw.category) ?? "",
    dateFrom: isoDay(raw.from) ?? "",
    dateTo: isoDay(raw.to) ?? "",
  }),
  writeFilters: (f) =>
    compact({
      direction: f.direction === "all" ? undefined : f.direction,
      category: trimmed(f.category),
      from: isoDay(f.dateFrom),
      to: isoDay(f.dateTo),
    }),
}

export const validateCashSearch = listSearchValidator(cashListSchema)
