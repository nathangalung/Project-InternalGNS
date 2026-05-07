import { apiRequest } from "@/lib/api-client"
import type { PoBackendStatus, PurchaseOrderItemRow, PurchaseOrderRow } from "@/types/api"

export type ListParams = {
  q?: string
  status?: PoBackendStatus
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

export async function list(params: ListParams = {}): Promise<PurchaseOrderRow[]> {
  const qs = buildQuery(params)
  return apiRequest<PurchaseOrderRow[]>({ path: `/purchase-orders${qs ? `?${qs}` : ""}` })
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
  payload: { fileName: string; fileSize: number; fileUrl: string },
): Promise<void> {
  await apiRequest<void>({
    path: `/purchase-orders/${id}/file`,
    method: "PATCH",
    body: payload,
  })
}

export async function updateNotes(id: number, notes: string): Promise<void> {
  await apiRequest<void>({
    path: `/purchase-orders/${id}/notes`,
    method: "PATCH",
    body: { notes },
  })
}
