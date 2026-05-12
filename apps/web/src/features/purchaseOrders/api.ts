import { apiList, apiRequest, buildQuery, type PaginatedList } from "@/lib/api-client"
import type {
  PoBackendStatus,
  PoUpdateItemsInput,
  PurchaseOrderItemRow,
  PurchaseOrderRow,
} from "@/types/api"

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

export async function get(id: number): Promise<PurchaseOrderRow> {
  return apiRequest<PurchaseOrderRow>({ path: `/purchase-orders/${id}` })
}

export async function listItems(id: number): Promise<PurchaseOrderItemRow[]> {
  return apiRequest<PurchaseOrderItemRow[]>({ path: `/purchase-orders/${id}/items` })
}

export async function getByQuotation(quotationId: number): Promise<PurchaseOrderRow | null> {
  try {
    return await apiRequest<PurchaseOrderRow>({
      path: `/purchase-orders/by-quotation/${quotationId}`,
    })
  } catch (err) {
    if (err instanceof Error && "status" in err && (err as { status: number }).status === 404) {
      return null
    }
    throw err
  }
}

export async function changeStatus(id: number, status: PoBackendStatus): Promise<void> {
  await apiRequest<void>({
    path: `/purchase-orders/${id}/status`,
    method: "PATCH",
    body: { status },
  })
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

export type PresignUpload = {
  uploadUrl: string
  objectKey: string
  expiresAt: number
}

export async function presignUpload(id: number, fileName: string): Promise<PresignUpload> {
  const qs = new URLSearchParams({ fileName }).toString()
  return apiRequest<PresignUpload>({
    path: `/purchase-orders/${id}/upload-url?${qs}`,
  })
}

export type PresignDownload = {
  downloadUrl: string
  fileName?: string
  expiresAt: number
}

export async function presignDownload(id: number): Promise<PresignDownload> {
  return apiRequest<PresignDownload>({
    path: `/purchase-orders/${id}/download-url`,
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
