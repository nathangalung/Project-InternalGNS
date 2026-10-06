import { apiList, apiRequest, buildQuery, downloadXlsx, type PaginatedList } from "@/lib/api-client"
import type { CashDirection, CashEntryInput, CashEntryRow, CashSummary } from "@/types/api"

export type CashEntryParams = {
  q?: string
  direction?: CashDirection
  category?: string
  dateFrom?: string
  dateTo?: string
  limit?: number
  offset?: number
}

// Filter query, paging optional.
function query(params: CashEntryParams): string {
  const qs = buildQuery({
    q: params.q,
    direction: params.direction,
    category: params.category,
    dateFrom: params.dateFrom,
    dateTo: params.dateTo,
    limit: params.limit,
    offset: params.offset,
  })
  return qs ? `?${qs}` : ""
}

export async function list(params: CashEntryParams = {}): Promise<PaginatedList<CashEntryRow>> {
  return apiList<CashEntryRow>({ path: `/cash-entries${query(params)}` })
}

// Totals of every matching entry.
export async function summary(params: CashEntryParams = {}): Promise<CashSummary> {
  const { limit: _l, offset: _o, ...filter } = params
  return apiRequest<CashSummary>({ path: `/cash-entries/summary${query(filter)}` })
}

export async function categories(): Promise<string[]> {
  return apiRequest<string[]>({ path: "/cash-entries/categories" })
}

export async function create(input: CashEntryInput): Promise<CashEntryRow> {
  return apiRequest<CashEntryRow>({ path: "/cash-entries", method: "POST", body: input })
}

// Replaces the version read.
export async function update(
  id: number,
  input: CashEntryInput,
  rowVersion: number,
): Promise<CashEntryRow> {
  return apiRequest<CashEntryRow>({
    path: `/cash-entries/${id}`,
    method: "PUT",
    body: input,
    headers: { "If-Match": String(rowVersion) },
  })
}

export async function remove(id: number): Promise<void> {
  await apiRequest<void>({ path: `/cash-entries/${id}`, method: "DELETE" })
}

export function exportXlsx(params: CashEntryParams = {}): Promise<void> {
  const { limit: _l, offset: _o, ...filter } = params
  return downloadXlsx(`/cash-entries/export.xlsx${query(filter)}`, "kas-lain.xlsx")
}
