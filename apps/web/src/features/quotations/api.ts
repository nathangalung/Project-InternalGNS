import { apiRequest } from "@/lib/api-client"
import type {
  CanonicalStatus,
  QuotationCreateInput,
  QuotationDetail,
  QuotationListParams,
  QuotationListRow,
  QuotationStatusCount,
  QuotationUpdateInput,
} from "@/types/api"

function buildListQuery(params: QuotationListParams): string {
  const search = new URLSearchParams()
  if (params.q) search.set("q", params.q)
  if (params.statuses && params.statuses.length > 0) {
    search.set("statuses", params.statuses.join(","))
  }
  if (params.sortBy) search.set("sortBy", params.sortBy)
  if (params.sortDir) search.set("sortDir", params.sortDir)
  if (params.limit !== undefined) search.set("limit", String(params.limit))
  if (params.offset !== undefined) search.set("offset", String(params.offset))
  return search.toString()
}

export async function list(params: QuotationListParams = {}): Promise<QuotationListRow[]> {
  const qs = buildListQuery(params)
  return apiRequest<QuotationListRow[]>({
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

export async function update(id: number, input: QuotationUpdateInput): Promise<{ id: number }> {
  return apiRequest<{ id: number }>({
    path: `/quotations/${id}`,
    method: "PUT",
    body: input,
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
