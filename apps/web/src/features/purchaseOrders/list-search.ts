import type { DatePreset } from "@/lib/date-range"
import {
  amount,
  compact,
  csvOf,
  type ListSchema,
  listSearchValidator,
  readRange,
  writeRange,
} from "@/lib/list-search"
import { PO_STATUS_ORDER } from "./PurchaseOrderDetail/helpers"
import type { PoFilterValues } from "./PurchaseOrderFilter"

// Filters as URL params.
export type PoFilterSearch = {
  status?: string
  preset?: DatePreset
  from?: string
  to?: string
  min?: string
  max?: string
}

function readFilters(raw: Record<string, unknown>): PoFilterValues {
  const range = readRange(raw.preset, raw.from, raw.to)
  return {
    preset: range.preset,
    startDate: range.start,
    endDate: range.end,
    statuses: csvOf(raw.status, PO_STATUS_ORDER),
    minHarga: amount(raw.min) ?? "",
    maxHarga: amount(raw.max) ?? "",
  }
}

function writeFilters(f: PoFilterValues): PoFilterSearch {
  return compact({
    status: f.statuses.join(",") || undefined,
    ...writeRange({ preset: f.preset, start: f.startDate, end: f.endDate }),
    min: amount(f.minHarga),
    max: amount(f.maxHarga),
  })
}

// No filter applied.
export const PO_FILTERS = readFilters({})

// Search, filters and page.
//
// The list always shows the newest PO date first, so it has no sort.
export const poListSchema: ListSchema<PoFilterValues, never, PoFilterSearch> = {
  filters: PO_FILTERS,
  readFilters,
  writeFilters,
}

export const validatePoSearch = listSearchValidator(poListSchema)
