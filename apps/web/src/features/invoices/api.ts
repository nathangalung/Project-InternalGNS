import { apiRequest } from "@/lib/api-client"
import type { InvoiceBackendRow, InvoiceBackendStatus, InvoiceSummary } from "@/types/api"

export type ListParams = {
  q?: string
  status?: InvoiceBackendStatus
  limit?: number
  offset?: number
}

function buildQuery(params: ListParams): string {
  const search = new URLSearchParams()
  if (params.q) search.set("q", params.q)
  if (params.status) search.set("status", params.status)
  if (params.limit !== undefined) search.set("limit", String(params.limit))
  if (params.offset !== undefined) search.set("offset", String(params.offset))
  return search.toString()
}

export async function list(params: ListParams = {}): Promise<InvoiceBackendRow[]> {
  const qs = buildQuery(params)
  return apiRequest<InvoiceBackendRow[]>({ path: `/invoices${qs ? `?${qs}` : ""}` })
}

export async function summary(): Promise<InvoiceSummary> {
  return apiRequest<InvoiceSummary>({ path: "/invoices/summary" })
}

export async function get(id: number): Promise<InvoiceBackendRow> {
  return apiRequest<InvoiceBackendRow>({ path: `/invoices/${id}` })
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
): Promise<void> {
  await apiRequest<void>({
    path: `/invoices/${id}/dates`,
    method: "PATCH",
    body: payload,
  })
}
