import { apiList, apiRequest, type PaginatedList } from "@/lib/api-client"
import type {
  InvoiceBackendRow,
  InvoiceBackendStatus,
  InvoiceItemRow,
  InvoiceSummary,
} from "@/types/api"

export type ListParams = {
  q?: string
  status?: InvoiceBackendStatus | string
  effectiveStatus?: string
  dateFrom?: string
  dateTo?: string
  dueFrom?: string
  dueTo?: string
  minTotal?: string
  maxTotal?: string
  sortBy?: "invoiceDate" | "dueDate" | "total" | "createdAt"
  sortDir?: "asc" | "desc"
  limit?: number
  offset?: number
}

function buildQuery(params: ListParams): string {
  const search = new URLSearchParams()
  if (params.q) search.set("q", params.q)
  if (params.status) search.set("status", params.status)
  if (params.effectiveStatus) search.set("effectiveStatus", params.effectiveStatus)
  if (params.dateFrom) search.set("dateFrom", params.dateFrom)
  if (params.dateTo) search.set("dateTo", params.dateTo)
  if (params.dueFrom) search.set("dueFrom", params.dueFrom)
  if (params.dueTo) search.set("dueTo", params.dueTo)
  if (params.minTotal) search.set("minTotal", params.minTotal)
  if (params.maxTotal) search.set("maxTotal", params.maxTotal)
  if (params.sortBy) search.set("sortBy", params.sortBy)
  if (params.sortDir) search.set("sortDir", params.sortDir)
  if (params.limit !== undefined) search.set("limit", String(params.limit))
  if (params.offset !== undefined) search.set("offset", String(params.offset))
  return search.toString()
}

export async function list(params: ListParams = {}): Promise<PaginatedList<InvoiceBackendRow>> {
  const qs = buildQuery(params)
  return apiList<InvoiceBackendRow>({ path: `/invoices${qs ? `?${qs}` : ""}` })
}

export async function summary(): Promise<InvoiceSummary> {
  return apiRequest<InvoiceSummary>({ path: "/invoices/summary" })
}

export async function get(id: number): Promise<InvoiceBackendRow> {
  return apiRequest<InvoiceBackendRow>({ path: `/invoices/${id}` })
}

export async function listItems(id: number): Promise<InvoiceItemRow[]> {
  return apiRequest<InvoiceItemRow[]>({ path: `/invoices/${id}/items` })
}

export async function getByQuotation(quotationId: number): Promise<InvoiceBackendRow | null> {
  try {
    return await apiRequest<InvoiceBackendRow>({
      path: `/invoices/by-quotation/${quotationId}`,
    })
  } catch (err) {
    if (err instanceof Error && "status" in err && (err as { status: number }).status === 404) {
      return null
    }
    throw err
  }
}

export async function changeStatus(id: number, status: InvoiceBackendStatus): Promise<void> {
  await apiRequest<void>({
    path: `/invoices/${id}/status`,
    method: "PATCH",
    body: { status },
  })
}

export async function updateDates(
  id: number,
  payload: { invoiceDate?: string; dueDate?: string },
  rowVersion: number,
): Promise<{ rowVersion: number }> {
  return apiRequest<{ rowVersion: number }>({
    path: `/invoices/${id}/dates`,
    method: "PATCH",
    body: payload,
    headers: { "If-Match": String(rowVersion) },
  })
}
