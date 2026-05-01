import { apiRequest } from "@/lib/api-client"
import { applyOverride, applyOverrides, setOverride } from "@/lib/local-overrides"
import type { ClientRow, ClientSearchHit, ContactRow } from "@/types/api"

const OVERRIDE_KEY = "gns_clients_overrides_v1"

export async function list(params: { limit?: number; offset?: number } = {}): Promise<ClientRow[]> {
  const search = new URLSearchParams()
  if (params.limit !== undefined) search.set("limit", String(params.limit))
  if (params.offset !== undefined) search.set("offset", String(params.offset))
  const qs = search.toString()
  const rows = await apiRequest<ClientRow[]>({ path: `/clients${qs ? `?${qs}` : ""}` })
  return applyOverrides(rows, OVERRIDE_KEY)
}

export async function get(id: number): Promise<ClientRow> {
  const row = await apiRequest<ClientRow>({ path: `/clients/${id}` })
  return applyOverride(row, OVERRIDE_KEY)
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

export type UpdateClientInput = {
  name: string
  npwp?: string
  address?: string
  email?: string
  countryCode: string
  tkuId?: string
  isActive: boolean
}

// No PATCH endpoint exists; persist as a localStorage override and return a
// merged row so the UI reflects the change.
export async function update(id: number, input: UpdateClientInput): Promise<ClientRow> {
  const current = await apiRequest<ClientRow>({ path: `/clients/${id}` })
  const merged: ClientRow = { ...current, ...input, updatedAt: new Date().toISOString() }
  setOverride<ClientRow>(OVERRIDE_KEY, id, {
    ...input,
    updatedAt: merged.updatedAt,
  })
  return merged
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
