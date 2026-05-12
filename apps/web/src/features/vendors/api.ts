import { apiList, apiRequest, type PaginatedList } from "@/lib/api-client"
import type { VendorContactInfo, VendorItemRow, VendorRow } from "@/types/api"

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

export type PresignLogoUpload = {
  uploadUrl: string
  objectKey: string
  expiresAt: number
}

export type PresignLogoDownload = {
  downloadUrl: string
  expiresAt: number
}

export async function presignLogoUpload(id: number, fileName: string): Promise<PresignLogoUpload> {
  const qs = new URLSearchParams({ fileName }).toString()
  return apiRequest<PresignLogoUpload>({ path: `/vendors/${id}/logo/upload-url?${qs}` })
}

export async function presignLogoDownload(id: number): Promise<PresignLogoDownload> {
  return apiRequest<PresignLogoDownload>({ path: `/vendors/${id}/logo/download-url` })
}

export async function updateLogo(id: number, objectKey: string): Promise<void> {
  await apiRequest<void>({
    path: `/vendors/${id}/logo`,
    method: "PATCH",
    body: { objectKey },
  })
}
