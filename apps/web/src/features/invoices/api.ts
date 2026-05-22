import { apiList, apiRequest, buildQuery, nullOn404, type PaginatedList } from "@/lib/api-client"
import type {
  InvoiceBackendRow,
  InvoiceBackendStatus,
  InvoiceItemRow,
  InvoiceSummary,
  PresignDownload,
  PresignUpload,
} from "@/types/api"

export type PresignAttachmentUpload = PresignUpload
export type PresignAttachmentDownload = PresignDownload

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
  return nullOn404(() =>
    apiRequest<InvoiceBackendRow>({ path: `/invoices/by-quotation/${quotationId}` }),
  )
}

export async function changeStatus(id: number, status: InvoiceBackendStatus): Promise<void> {
  await apiRequest<void>({
    path: `/invoices/${id}/status`,
    method: "PATCH",
    body: { status },
  })
}

export async function presignAttachmentUpload(
  id: number,
  fileName: string,
): Promise<PresignAttachmentUpload> {
  const qs = new URLSearchParams({ fileName }).toString()
  return apiRequest<PresignAttachmentUpload>({
    path: `/invoices/${id}/attachment/upload-url?${qs}`,
  })
}

export async function presignAttachmentDownload(id: number): Promise<PresignAttachmentDownload> {
  return apiRequest<PresignAttachmentDownload>({ path: `/invoices/${id}/attachment/download-url` })
}

export async function updateAttachment(id: number, objectKey: string): Promise<void> {
  await apiRequest<void>({
    path: `/invoices/${id}/attachment`,
    method: "PATCH",
    body: { objectKey },
  })
}
