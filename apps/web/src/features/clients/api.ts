import { apiRequest } from "@/lib/api-client"
import type { ClientRow, ClientSearchHit, ContactRow } from "@/types/api"

export async function list(params: { limit?: number; offset?: number } = {}): Promise<ClientRow[]> {
  const search = new URLSearchParams()
  if (params.limit !== undefined) search.set("limit", String(params.limit))
  if (params.offset !== undefined) search.set("offset", String(params.offset))
  const qs = search.toString()
  return apiRequest<ClientRow[]>({ path: `/clients${qs ? `?${qs}` : ""}` })
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

export async function listContacts(companyId: number): Promise<ContactRow[]> {
  return apiRequest<ContactRow[]>({ path: `/clients/${companyId}/contacts` })
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
