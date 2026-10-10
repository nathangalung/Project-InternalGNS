import { apiList, apiRequest, buildQuery, type PaginatedList } from "@/lib/api-client"
import type {
  ClientQuotationRow,
  ClientRow,
  ClientSearchHit,
  ClientSummary,
  ContactRow,
  CreateClientInput,
  CreateContactInput,
  ObjectKeyInput,
  PresignDownload,
  PresignUpload,
  UpdateClientInput,
  UpdateContactInput,
} from "@/types/api"

export type { UpdateClientInput, UpdateContactInput } from "@/types/api"

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
  const qs = buildQuery({
    q: params.q,
    isActive: params.isActive,
    countryCode: params.countryCode,
    minTotal: params.minTotal,
    sortBy: params.sortBy,
    sortDir: params.sortDir,
    limit: params.limit,
    offset: params.offset,
  })
  return apiList<ClientRow>({ path: `/clients${qs ? `?${qs}` : ""}` })
}

export async function get(id: number): Promise<ClientRow> {
  return apiRequest<ClientRow>({ path: `/clients/${id}` })
}

export async function search(
  q: string,
  options: { minScore?: number; limit?: number } = {},
): Promise<ClientSearchHit[]> {
  const qs = buildQuery({ q, minScore: options.minScore, limit: options.limit })
  return apiRequest<ClientSearchHit[]>({ path: `/clients/search?${qs}` })
}

export async function create(input: CreateClientInput): Promise<ClientRow> {
  return apiRequest<ClientRow>({
    path: "/clients",
    method: "POST",
    body: input,
  })
}

export async function update(id: number, input: UpdateClientInput): Promise<ClientRow> {
  return apiRequest<ClientRow>({
    path: `/clients/${id}`,
    method: "PUT",
    body: input,
  })
}

// Unused client, deleted for good.
export async function remove(id: number): Promise<void> {
  await apiRequest<void>({ path: `/clients/${id}`, method: "DELETE" })
}

export async function listContacts(companyId: number): Promise<ContactRow[]> {
  return apiRequest<ContactRow[]>({ path: `/clients/${companyId}/contacts` })
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

export async function updateContact(
  companyId: number,
  contactId: number,
  input: UpdateContactInput,
): Promise<ContactRow> {
  return apiRequest<ContactRow>({
    path: `/clients/${companyId}/contacts/${contactId}`,
    method: "PATCH",
    body: input,
  })
}

export async function deleteContact(companyId: number, contactId: number): Promise<void> {
  await apiRequest<void>({
    path: `/clients/${companyId}/contacts/${contactId}`,
    method: "DELETE",
  })
}

export async function presignLogoUpload(id: number, fileName: string): Promise<PresignUpload> {
  const qs = new URLSearchParams({ fileName }).toString()
  return apiRequest<PresignUpload>({ path: `/clients/${id}/logo/upload-url?${qs}` })
}

export async function presignLogoDownload(id: number): Promise<PresignDownload> {
  return apiRequest<PresignDownload>({ path: `/clients/${id}/logo/download-url` })
}

export async function updateLogo(id: number, objectKey: string): Promise<void> {
  await apiRequest<void>({
    path: `/clients/${id}/logo`,
    method: "PATCH",
    body: { objectKey } satisfies ObjectKeyInput,
  })
}

// The newest quotations, newest first.
export async function listRecentQuotations(id: number): Promise<ClientQuotationRow[]> {
  return apiRequest<ClientQuotationRow[]>({ path: `/clients/${id}/quotations` })
}
