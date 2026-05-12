import { apiList, apiRequest, type PaginatedList } from "@/lib/api-client"
import type {
  CanonicalStatus,
  QuotationCreateInput,
  QuotationDetail,
  QuotationItemRequestCreateInput,
  QuotationItemRequestRow,
  QuotationItemRequestUpdateInput,
  QuotationListParams,
  QuotationListRow,
  QuotationRevisionRow,
  QuotationStatusCount,
  QuotationUpdateInput,
} from "@/types/api"

// Build list query string.
function buildListQuery(params: QuotationListParams): string {
  const search = new URLSearchParams()
  if (params.q) search.set("q", params.q)
  if (params.statuses && params.statuses.length > 0) {
    search.set("status", params.statuses.join(","))
  }
  if (params.dateFrom) search.set("dateFrom", params.dateFrom)
  if (params.dateTo) search.set("dateTo", params.dateTo)
  if (params.minTotal) search.set("minTotal", params.minTotal)
  if (params.maxTotal) search.set("maxTotal", params.maxTotal)
  if (params.sortBy) search.set("sortBy", params.sortBy)
  if (params.sortDir) search.set("sortDir", params.sortDir)
  if (params.limit !== undefined) search.set("limit", String(params.limit))
  if (params.offset !== undefined) search.set("offset", String(params.offset))
  return search.toString()
}

export async function list(
  params: QuotationListParams = {},
): Promise<PaginatedList<QuotationListRow>> {
  const qs = buildListQuery(params)
  return apiList<QuotationListRow>({
    path: `/quotations${qs ? `?${qs}` : ""}`,
  })
}

export async function stats(): Promise<QuotationStatusCount[]> {
  return apiRequest<QuotationStatusCount[]>({ path: "/quotations/stats" })
}

export async function get(id: number): Promise<QuotationDetail> {
  return apiRequest<QuotationDetail>({ path: `/quotations/${id}` })
}

export async function create(input: QuotationCreateInput): Promise<{ id: number }> {
  return apiRequest<{ id: number }>({
    path: "/quotations",
    method: "POST",
    body: input,
  })
}

export async function update(
  id: number,
  input: QuotationUpdateInput,
  rowVersion: number,
): Promise<{ id: number; rowVersion: number }> {
  return apiRequest<{ id: number; rowVersion: number }>({
    path: `/quotations/${id}`,
    method: "PUT",
    body: input,
    headers: { "If-Match": String(rowVersion) },
  })
}

export async function changeStatus(
  id: number,
  status: CanonicalStatus,
  note?: string,
): Promise<void> {
  await apiRequest<void>({
    path: `/quotations/${id}/status`,
    method: "PATCH",
    body: { status, note },
  })
}

export async function send(id: number): Promise<void> {
  await apiRequest<void>({
    path: `/quotations/${id}/send`,
    method: "POST",
  })
}

export async function listRevisions(id: number): Promise<QuotationRevisionRow[]> {
  return apiRequest<QuotationRevisionRow[]>({ path: `/quotations/${id}/revisions` })
}

export async function listRequests(quotationId: number): Promise<QuotationItemRequestRow[]> {
  return apiRequest<QuotationItemRequestRow[]>({
    path: `/quotations/${quotationId}/requests`,
  })
}

export async function createRequest(
  quotationId: number,
  input: QuotationItemRequestCreateInput,
): Promise<QuotationItemRequestRow> {
  return apiRequest<QuotationItemRequestRow>({
    path: `/quotations/${quotationId}/requests`,
    method: "POST",
    body: input,
  })
}

export async function updateRequest(
  quotationId: number,
  requestId: number,
  input: QuotationItemRequestUpdateInput,
): Promise<QuotationItemRequestRow> {
  return apiRequest<QuotationItemRequestRow>({
    path: `/quotations/${quotationId}/requests/${requestId}`,
    method: "PUT",
    body: input,
  })
}

export async function deleteRequest(quotationId: number, requestId: number): Promise<void> {
  await apiRequest<void>({
    path: `/quotations/${quotationId}/requests/${requestId}`,
    method: "DELETE",
  })
}
