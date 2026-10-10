import { apiList, apiRequest, buildQuery, type PaginatedList } from "@/lib/api-client"
import type {
  CreateVendorInput,
  ObjectKeyInput,
  PresignDownload,
  PresignUpload,
  UpdateVendorInput,
  VendorItemRow,
  VendorQuotationRow,
  VendorRow,
} from "@/types/api"

export type { UpdateVendorInput } from "@/types/api"

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
  const qs = buildQuery({
    q: params.q,
    isActive: params.isActive,
    countryName: params.countryName,
    minTotal: params.minTotal,
    sortBy: params.sortBy,
    sortDir: params.sortDir,
    limit: params.limit,
    offset: params.offset,
  })
  return apiList<VendorRow>({ path: `/vendors${qs ? `?${qs}` : ""}` })
}

export async function get(id: number): Promise<VendorRow> {
  return apiRequest<VendorRow>({ path: `/vendors/${id}` })
}

export type VendorItemsPage = {
  limit: number
  offset: number
}

// One page, total from header.
export async function listItems(
  vendorId: number,
  page: VendorItemsPage,
): Promise<PaginatedList<VendorItemRow>> {
  const qs = buildQuery({ limit: page.limit, offset: page.offset })
  return apiList<VendorItemRow>({ path: `/vendors/${vendorId}/items?${qs}` })
}

export async function create(input: CreateVendorInput): Promise<VendorRow> {
  return apiRequest<VendorRow>({
    path: "/vendors",
    method: "POST",
    body: input,
  })
}

export async function update(id: number, input: UpdateVendorInput): Promise<VendorRow> {
  return apiRequest<VendorRow>({
    path: `/vendors/${id}`,
    method: "PUT",
    body: input,
  })
}

// Unused vendor, deleted for good.
export async function remove(id: number): Promise<void> {
  await apiRequest<void>({ path: `/vendors/${id}`, method: "DELETE" })
}

export async function presignLogoUpload(id: number, fileName: string): Promise<PresignUpload> {
  const qs = new URLSearchParams({ fileName }).toString()
  return apiRequest<PresignUpload>({ path: `/vendors/${id}/logo/upload-url?${qs}` })
}

export async function presignLogoDownload(id: number): Promise<PresignDownload> {
  return apiRequest<PresignDownload>({ path: `/vendors/${id}/logo/download-url` })
}

export async function updateLogo(id: number, objectKey: string): Promise<void> {
  await apiRequest<void>({
    path: `/vendors/${id}/logo`,
    method: "PATCH",
    body: { objectKey } satisfies ObjectKeyInput,
  })
}

// The newest quotations, newest first.
export async function listRecentQuotations(id: number): Promise<VendorQuotationRow[]> {
  return apiRequest<VendorQuotationRow[]>({ path: `/vendors/${id}/quotations` })
}
