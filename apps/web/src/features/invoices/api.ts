import {
  apiList,
  apiRequest,
  buildQuery,
  downloadXlsx,
  nullOn404,
  type PaginatedList,
} from "@/lib/api-client"
import type {
  InvoiceBackendRow,
  InvoiceBackendStatus,
  InvoiceDetail,
  InvoiceItemRow,
  InvoiceSummary,
  PresignDownload,
  PresignUpload,
} from "@/types/api"
import type { ChangeInvoiceStatusInput, UpdateInvoiceDatesInput } from "./types"

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

// Download the filtered list as XLSX.
export function exportXlsx(params: ListParams = {}): Promise<void> {
  const qs = buildQuery(params)
  return downloadXlsx(`/invoices/export.xlsx${qs ? `?${qs}` : ""}`, "invoice-export.xlsx")
}

// Download the filtered list as the DJP Coretax bulk-import workbook.
export function exportCoretaxXlsx(params: ListParams = {}): Promise<void> {
  const qs = buildQuery(params)
  return downloadXlsx(`/invoices/coretax.xlsx${qs ? `?${qs}` : ""}`, "coretax-export.xlsx")
}

export async function summary(): Promise<InvoiceSummary> {
  return apiRequest<InvoiceSummary>({ path: "/invoices/summary" })
}

export async function listItems(id: number): Promise<InvoiceItemRow[]> {
  return apiRequest<InvoiceItemRow[]>({ path: `/invoices/${id}/items` })
}

// Newest invoice, the Pengganti when one exists.
export async function getByQuotation(quotationId: number): Promise<InvoiceDetail | null> {
  return nullOn404(() =>
    apiRequest<InvoiceDetail>({ path: `/invoices/by-quotation/${quotationId}` }),
  )
}

// One invoice by its own id.
export async function getById(id: number): Promise<InvoiceDetail | null> {
  return nullOn404(() => apiRequest<InvoiceDetail>({ path: `/invoices/${id}` }))
}

export async function changeStatus(id: number, input: ChangeInvoiceStatusInput): Promise<void> {
  await apiRequest<void>({
    path: `/invoices/${id}/status`,
    method: "PATCH",
    body: input,
  })
}

// Issue the Pengganti for a cancelled invoice.
export async function replace(id: number): Promise<InvoiceDetail> {
  return apiRequest<InvoiceDetail>({ path: `/invoices/${id}/replacement`, method: "POST" })
}

// Returns the new row version.
export async function updateDates(
  id: number,
  input: UpdateInvoiceDatesInput,
  rowVersion: number,
): Promise<{ rowVersion: number }> {
  return apiRequest<{ rowVersion: number }>({
    path: `/invoices/${id}/dates`,
    method: "PATCH",
    body: input,
    headers: { "If-Match": String(rowVersion) },
  })
}

export async function presignPaymentProofUpload(
  id: number,
  fileName: string,
): Promise<PresignUpload> {
  const qs = new URLSearchParams({ fileName }).toString()
  return apiRequest<PresignUpload>({ path: `/invoices/${id}/payment-proof/upload-url?${qs}` })
}

export async function presignPaymentProofDownload(id: number): Promise<PresignDownload> {
  return apiRequest<PresignDownload>({ path: `/invoices/${id}/payment-proof/download-url` })
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
