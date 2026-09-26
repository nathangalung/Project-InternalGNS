import {
  apiList,
  apiRequest,
  buildQuery,
  downloadXlsx,
  nullOn404,
  type PaginatedList,
} from "@/lib/api-client"
import type {
  PoBackendStatus,
  PoStatusEvent,
  PoUpdateItemsInput,
  PresignDownload,
  PresignUpload,
  PurchaseOrderItemRow,
  PurchaseOrderRow,
} from "@/types/api"

export type { PresignDownload, PresignUpload } from "@/types/api"

export type ListParams = {
  q?: string
  status?: PoBackendStatus | string
  dateFrom?: string
  dateTo?: string
  minTotal?: string
  maxTotal?: string
  sortBy?: "poDate" | "createdAt" | "total" | "poNumber"
  sortDir?: "asc" | "desc"
  limit?: number
  offset?: number
}

export async function list(params: ListParams = {}): Promise<PaginatedList<PurchaseOrderRow>> {
  const qs = buildQuery(params)
  return apiList<PurchaseOrderRow>({ path: `/purchase-orders${qs ? `?${qs}` : ""}` })
}

// Filtered list XLSX download.
//
// The workbook lists the delivery notes.
export function exportXlsx(params: ListParams = {}): Promise<void> {
  const qs = buildQuery(params)
  return downloadXlsx(
    `/purchase-orders/export.xlsx${qs ? `?${qs}` : ""}`,
    "delivery-note-export.xlsx",
  )
}

export async function get(id: number): Promise<PurchaseOrderRow> {
  return apiRequest<PurchaseOrderRow>({ path: `/purchase-orders/${id}` })
}

export async function listItems(id: number): Promise<PurchaseOrderItemRow[]> {
  return apiRequest<PurchaseOrderItemRow[]>({ path: `/purchase-orders/${id}/items` })
}

export async function getByQuotation(quotationId: number): Promise<PurchaseOrderRow | null> {
  return nullOn404(() =>
    apiRequest<PurchaseOrderRow>({ path: `/purchase-orders/by-quotation/${quotationId}` }),
  )
}

// Note is required for CANCELLED.
export async function changeStatus(
  id: number,
  status: PoBackendStatus,
  note?: string,
): Promise<void> {
  await apiRequest<void>({
    path: `/purchase-orders/${id}/status`,
    method: "PATCH",
    body: note ? { status, note } : { status },
  })
}

// Status timeline, oldest first.
export async function listHistory(id: number): Promise<PoStatusEvent[]> {
  return apiRequest<PoStatusEvent[]>({ path: `/purchase-orders/${id}/history` })
}

// Detach the file.
//
// UPLOADED returns to PENDING.
export async function removeFile(id: number): Promise<void> {
  await apiRequest<void>({ path: `/purchase-orders/${id}/file`, method: "DELETE" })
}

export async function updateFile(
  id: number,
  payload: { fileName: string; fileSize: number; objectKey: string },
): Promise<void> {
  await apiRequest<void>({
    path: `/purchase-orders/${id}/file`,
    method: "PATCH",
    body: payload,
  })
}

export async function presignUpload(id: number, fileName: string): Promise<PresignUpload> {
  const qs = new URLSearchParams({ fileName }).toString()
  return apiRequest<PresignUpload>({
    path: `/purchase-orders/${id}/upload-url?${qs}`,
  })
}

export async function presignDownload(id: number): Promise<PresignDownload> {
  return apiRequest<PresignDownload>({
    path: `/purchase-orders/${id}/download-url`,
  })
}

export async function updateDetails(
  id: number,
  payload: { poNumber: string; poDate: string },
  rowVersion: number,
): Promise<void> {
  await apiRequest<void>({
    path: `/purchase-orders/${id}/details`,
    method: "PATCH",
    body: payload,
    headers: { "If-Match": String(rowVersion) },
  })
}

export async function updateItems(
  id: number,
  input: PoUpdateItemsInput,
  rowVersion: number,
): Promise<{ id: number; rowVersion: number }> {
  return apiRequest<{ id: number; rowVersion: number }>({
    path: `/purchase-orders/${id}/items`,
    method: "PUT",
    body: input,
    headers: { "If-Match": String(rowVersion) },
  })
}
