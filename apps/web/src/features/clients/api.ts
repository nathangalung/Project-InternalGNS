import { apiList, apiRequest, type PaginatedList } from "@/lib/api-client"
import type { ClientRow, ClientSearchHit, ClientSummary, ContactRow } from "@/types/api"

export async function summary(): Promise<ClientSummary> {
  return apiRequest<ClientSummary>({ path: "/clients/summary" })
}

export type ClientListParams = {
  q?: string
  isActive?: boolean
  countryCode?: string
  minTotal?: string
  sortBy?: "name" | "createdAt" | "totalPurchase" | "quotationCount"
  sortDir?: "asc" | "desc"
  limit?: number
  offset?: number
}

export async function list(params: ClientListParams = {}): Promise<PaginatedList<ClientRow>> {
  const search = new URLSearchParams()
  if (params.q) search.set("q", params.q)
  if (params.isActive !== undefined) search.set("isActive", String(params.isActive))
  if (params.countryCode) search.set("countryCode", params.countryCode)
  if (params.minTotal) search.set("minTotal", params.minTotal)
  if (params.sortBy) search.set("sortBy", params.sortBy)
  if (params.sortDir) search.set("sortDir", params.sortDir)
  if (params.limit !== undefined) search.set("limit", String(params.limit))
  if (params.offset !== undefined) search.set("offset", String(params.offset))
  const qs = search.toString()
  return apiList<ClientRow>({ path: `/clients${qs ? `?${qs}` : ""}` })
}

export async function get(id: number): Promise<ClientRow> {
  return apiRequest<ClientRow>({ path: `/clients/${id}` })
}

export async function search(
  q: string,
  options: { minScore?: number; limit?: number } = {},
): Promise<ClientSearchHit[]> {
  const params = new URLSearchParams({ q })
  if (options.minScore !== undefined) params.set("minScore", String(options.minScore))
  if (options.limit !== undefined) params.set("limit", String(options.limit))
  return apiRequest<ClientSearchHit[]>({ path: `/clients/search?${params.toString()}` })
}

type CreateClientInput = {
  number?: string
  name: string
  npwp?: string
  address?: string
  email?: string
  countryCode?: string
  tkuId?: string
}

export async function create(input: CreateClientInput): Promise<ClientRow> {
  return apiRequest<ClientRow>({
    path: "/clients",
    method: "POST",
    body: input,
  })
}

export type UpdateClientInput = {
  name: string
  npwp?: string
  address?: string
  email?: string
  countryCode: string
  tkuId?: string
  isActive: boolean
}

export async function update(id: number, input: UpdateClientInput): Promise<ClientRow> {
  return apiRequest<ClientRow>({
    path: `/clients/${id}`,
    method: "PUT",
    body: input,
  })
}

type CreateContactInput = {
  name: string
  email?: string
  phone?: string
  title?: string
  countryCode?: string
}

export async function createContact(
  companyId: number,
  input: CreateContactInput,
): Promise<ContactRow> {
  return apiRequest<ContactRow>({
    path: `/clients/${companyId}/contacts`,
    method: "POST",
    body: input,
  })
}
