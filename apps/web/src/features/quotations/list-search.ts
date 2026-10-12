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
import {
  QUOTATION_STATUSES,
  type QuotationStatusLabel,
  quotationStatusFromLabel,
  quotationStatusLabel,
} from "@/lib/status"
import type { SortableRowKey } from "./QuotationList/helpers"

// Quotation list filters.
export type QuotationListFilters = {
  preset: DatePreset
  startDate: string
  endDate: string
  statuses: QuotationStatusLabel[]
  minHarga: string
  maxHarga: string
}

// Filters as URL params.
export type QuotationFilterSearch = {
  status?: string
  preset?: DatePreset
  from?: string
  to?: string
  min?: string
  max?: string
}

const SORT_KEYS: readonly SortableRowKey[] = ["displayNo", "version", "date", "total"]

function readFilters(raw: Record<string, unknown>): QuotationListFilters {
  const range = readRange(raw.preset, raw.from, raw.to)
  return {
    preset: range.preset,
    startDate: range.start,
    endDate: range.end,
    statuses: csvOf(raw.status, QUOTATION_STATUSES).map(quotationStatusLabel),
    minHarga: amount(raw.min) ?? "",
    maxHarga: amount(raw.max) ?? "",
  }
}

function writeFilters(f: QuotationListFilters): QuotationFilterSearch {
  return compact({
    status: f.statuses.map(quotationStatusFromLabel).join(",") || undefined,
    ...writeRange({ preset: f.preset, start: f.startDate, end: f.endDate }),
    min: amount(f.minHarga),
    max: amount(f.maxHarga),
  })
}

// No filter applied.
export const QUOTATION_FILTERS = readFilters({})

// Search, filters, page and sort.
//
// Statuses go by key, so the URL carries no Indonesian label.
export const quotationListSchema: ListSchema<
  QuotationListFilters,
  SortableRowKey,
  QuotationFilterSearch
> = {
  filters: QUOTATION_FILTERS,
  sortKeys: SORT_KEYS,
  readFilters,
  writeFilters,
}

export const validateQuotationSearch = listSearchValidator(quotationListSchema)
