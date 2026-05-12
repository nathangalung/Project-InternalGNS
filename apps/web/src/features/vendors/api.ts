import { apiList, apiRequest, type PaginatedList } from "@/lib/api-client"
import type { VendorContactInfo, VendorItemRow, VendorRow, VendorSearchHit } from "@/types/api"

export type VendorListParams = {
  q?: string
  isActive?: boolean
  countryName?: string
  minTotal?: string
  sortBy?: "name" | "createdAt" | "totalPurchase" | "productCount"
  sortDir?: "asc" | "desc"
  limit?: number
  offset?: number
}

export async function list(params: VendorListParams = {}): Promise<PaginatedList<VendorRow>> {
  const search = new URLSearchParams()
  if (params.q) search.set("q", params.q)
  if (params.isActive !== undefined) search.set("isActive", String(params.isActive))
  if (params.countryName) search.set("countryName", params.countryName)
  if (params.minTotal) search.set("minTotal", params.minTotal)
  if (params.sortBy) search.set("sortBy", params.sortBy)
  if (params.sortDir) search.set("sortDir", params.sortDir)
  if (params.limit !== undefined) search.set("limit", String(params.limit))
  if (params.offset !== undefined) search.set("offset", String(params.offset))
  const qs = search.toString()
  return apiList<VendorRow>({ path: `/vendors${qs ? `?${qs}` : ""}` })
}

export async function get(id: number): Promise<VendorRow> {
  return apiRequest<VendorRow>({ path: `/vendors/${id}` })
}

export async function search(
  q: string,
  options: { minScore?: number; limit?: number } = {},
): Promise<VendorSearchHit[]> {
  const params = new URLSearchParams({ q })
  if (options.minScore !== undefined) params.set("minScore", String(options.minScore))
  if (options.limit !== undefined) params.set("limit", String(options.limit))
  return apiRequest<VendorSearchHit[]>({ path: `/vendors/search?${params.toString()}` })
}

export async function listItems(vendorId: number): Promise<VendorItemRow[]> {
  return apiRequest<VendorItemRow[]>({ path: `/vendors/${vendorId}/items` })
}

type CreateVendorInput = {
  name: string
  location?: string
  contactInfo?: VendorContactInfo
}

export async function create(input: CreateVendorInput): Promise<VendorRow> {
  return apiRequest<VendorRow>({
    path: "/vendors",
    method: "POST",
    body: input,
  })
}

export type UpdateVendorInput = {
  name: string
  location?: string
  contactInfo?: VendorContactInfo
  isActive: boolean
}

export async function update(id: number, input: UpdateVendorInput): Promise<VendorRow> {
  return apiRequest<VendorRow>({
    path: `/vendors/${id}`,
    method: "PUT",
    body: input,
  })
}
