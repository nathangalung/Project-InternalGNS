import { apiList, apiRequest, buildQuery, type PaginatedList } from "@/lib/api-client"
import type {
  ClientRow,
  ClientSearchHit,
  ClientSummary,
  ContactRow,
  PresignDownload,
  PresignUpload,
} from "@/types/api"

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
    body: { objectKey },
  })
}
