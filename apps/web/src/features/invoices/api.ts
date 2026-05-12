import { apiList, apiRequest, buildQuery, type PaginatedList } from "@/lib/api-client"
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

export async function list(params: ListParams = {}): Promise<PaginatedList<InvoiceBackendRow>> {
  const qs = buildQuery(params)
  return apiList<InvoiceBackendRow>({ path: `/invoices${qs ? `?${qs}` : ""}` })
}

export async function summary(): Promise<InvoiceSummary> {
  return apiRequest<InvoiceSummary>({ path: "/invoices/summary" })
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
