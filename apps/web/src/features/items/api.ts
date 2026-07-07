import { apiList, apiRequest, buildQuery, type PaginatedList } from "@/lib/api-client"
import type {
  AdvancedSearchResponse,
  ItemPriceHistoryRow,
  ItemRow,
  ItemVendorRow,
  MatchRowInput,
  MatchRowsResponse,
  PresignDownload,
  PresignUpload,
} from "@/types/api"

export type ItemListParams = {
  q?: string
  isActive?: boolean
  unitId?: number
  sortBy?: "name" | "createdAt" | "impaCode"
  sortDir?: "asc" | "desc"
  limit?: number
  offset?: number
}

export async function list(params: ItemListParams = {}): Promise<PaginatedList<ItemRow>> {
  const qs = buildQuery({
    q: params.q,
    isActive: params.isActive,
    unitId: params.unitId,
    sortBy: params.sortBy,
    sortDir: params.sortDir,
    limit: params.limit,
    offset: params.offset,
  })
  return apiList<ItemRow>({ path: `/items${qs ? `?${qs}` : ""}` })
}

export async function get(id: number): Promise<ItemRow> {
  return apiRequest<ItemRow>({ path: `/items/${id}` })
}

export type UpdateItemInput = {
  name: string
  impaCode?: string
  defaultUnitId?: number
  description?: string
  isActive: boolean
}

export async function update(id: number, input: UpdateItemInput): Promise<ItemRow> {
  return apiRequest<ItemRow>({
    path: `/items/${id}`,
    method: "PUT",
    body: input,
  })
}

// Multi-source search: items + vendor offers + request history.
// Tier ranks: ITEM_AUTO > VENDOR_OFFER > ITEM_SUGGESTED > REQUEST_HISTORY > ITEM_FUZZY.
export async function searchAdvanced(
  q: string,
  options: { minScore?: number; limit?: number; isActive?: boolean } = {},
): Promise<AdvancedSearchResponse> {
  const qs = buildQuery({
    q,
    minScore: options.minScore,
    limit: options.limit,
    isActive: options.isActive,
  })
  return apiRequest<AdvancedSearchResponse>({ path: `/items/search-advanced?${qs}` })
}

export async function matchRows(
  rows: MatchRowInput[],
  options: { minScore?: number; autoCreate?: boolean } = {},
): Promise<MatchRowsResponse> {
  return apiRequest<MatchRowsResponse>({
    path: "/items/match-rows",
    method: "POST",
    body: { rows, minScore: options.minScore, autoCreate: options.autoCreate },
  })
}

export async function listVendors(itemId: number): Promise<ItemVendorRow[]> {
  return apiRequest<ItemVendorRow[]>({ path: `/items/${itemId}/vendors` })
}

export type AddVendorToItemInput = {
  vendorId: number
  vendorSku?: string
  costPrice?: string
  productUrl?: string
}

export async function addVendor(
  itemId: number,
  input: AddVendorToItemInput,
): Promise<ItemVendorRow> {
  return apiRequest<ItemVendorRow>({
    path: `/items/${itemId}/vendors`,
    method: "POST",
    body: input,
  })
}

export async function priceHistory(
  itemId: number,
  options: { limit?: number } = {},
): Promise<ItemPriceHistoryRow[]> {
  const qs = buildQuery({ limit: options.limit })
  return apiRequest<ItemPriceHistoryRow[]>({
    path: `/items/${itemId}/price-history${qs ? `?${qs}` : ""}`,
  })
}

type CreateItemInput = {
  name: string
  impaCode?: string
  defaultUnitId?: number
  description?: string
  isActive?: boolean
}

export async function create(input: CreateItemInput): Promise<ItemRow> {
  return apiRequest<ItemRow>({
    path: "/items",
    method: "POST",
    body: input,
  })
}

export async function presignImageUpload(id: number, fileName: string): Promise<PresignUpload> {
  const qs = new URLSearchParams({ fileName }).toString()
  return apiRequest<PresignUpload>({ path: `/items/${id}/image/upload-url?${qs}` })
}

export async function presignImageDownload(id: number): Promise<PresignDownload> {
  return apiRequest<PresignDownload>({ path: `/items/${id}/image/download-url` })
}

export async function updateImage(id: number, objectKey: string): Promise<void> {
  await apiRequest<void>({
    path: `/items/${id}/image`,
    method: "PATCH",
    body: { objectKey },
  })
}
