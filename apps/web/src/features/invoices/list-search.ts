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
import type { InvoiceBackendStatus } from "@/types/api"
import type { InvoiceFilterValues } from "./InvoiceFilter"
import type { InvoiceDisplayStatus } from "./types"

// Filters as URL params.
export type InvoiceFilterSearch = {
  status?: string
  created?: DatePreset
  createdFrom?: string
  createdTo?: string
  due?: DatePreset
  dueFrom?: string
  dueTo?: string
  min?: string
  max?: string
}

// Filter status by API key.
const STATUS_BY_KEY: Record<InvoiceBackendStatus, InvoiceDisplayStatus> = {
  draft: "DRAF",
  sent: "DIKIRIM",
  paid: "DIBAYAR",
  overdue: "TERLAMBAT",
  cancelled: "DIBATALKAN",
}
const STATUS_KEYS = Object.keys(STATUS_BY_KEY) as InvoiceBackendStatus[]
const KEY_BY_STATUS = Object.fromEntries(STATUS_KEYS.map((k) => [STATUS_BY_KEY[k], k])) as Record<
  InvoiceDisplayStatus,
  InvoiceBackendStatus
>

function readFilters(raw: Record<string, unknown>): InvoiceFilterValues {
  const created = readRange(raw.created, raw.createdFrom, raw.createdTo)
  const due = readRange(raw.due, raw.dueFrom, raw.dueTo)
  return {
    createdPreset: created.preset,
    createdStart: created.start,
    createdEnd: created.end,
    duePreset: due.preset,
    dueStart: due.start,
    dueEnd: due.end,
    statuses: csvOf(raw.status, STATUS_KEYS).map((k) => STATUS_BY_KEY[k]),
    minHarga: amount(raw.min) ?? "",
    maxHarga: amount(raw.max) ?? "",
  }
}

function writeFilters(f: InvoiceFilterValues): InvoiceFilterSearch {
  const created = writeRange({ preset: f.createdPreset, start: f.createdStart, end: f.createdEnd })
  const due = writeRange({ preset: f.duePreset, start: f.dueStart, end: f.dueEnd })
  return compact({
    status: f.statuses.map((s) => KEY_BY_STATUS[s]).join(",") || undefined,
    created: created.preset,
    createdFrom: created.from,
    createdTo: created.to,
    due: due.preset,
    dueFrom: due.from,
    dueTo: due.to,
    min: amount(f.minHarga),
    max: amount(f.maxHarga),
  })
}

// No filter applied.
export const INVOICE_FILTERS = readFilters({})

// Search, filters and page.
//
// Statuses go by API key; Dibatalkan is cancelled.
export const invoiceListSchema: ListSchema<InvoiceFilterValues, never, InvoiceFilterSearch> = {
  filters: INVOICE_FILTERS,
  readFilters,
  writeFilters,
}

export const validateInvoiceSearch = listSearchValidator(invoiceListSchema)
