import { apiList, apiRequest, buildQuery, type PaginatedList } from "@/lib/api-client"
import type {
  AddVendorToItemInput,
  AdvancedSearchResponse,
  CreateItemInput,
  ItemGallery,
  ItemPriceHistoryRow,
  ItemQuotationRow,
  ItemRow,
  ItemVendorRow,
  LineRecommendation,
  MatchRowInput,
  MatchRowsInput,
  MatchRowsResponse,
  ObjectKeyInput,
  PresignDownload,
  PresignUpload,
  UpdateItemInput,
} from "@/types/api"

export type { AddVendorToItemInput, UpdateItemInput } from "@/types/api"

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

export async function update(id: number, input: UpdateItemInput): Promise<ItemRow> {
  return apiRequest<ItemRow>({
    path: `/items/${id}`,
    method: "PUT",
    body: input,
  })
}

export type SearchAdvancedOptions = {
  minScore?: number
  limit?: number
  offset?: number
  isActive?: boolean
}

// Multi-source item search.
//
// Searches items, vendor offers and request history. One page of hits; total
// and counts cover every match.
// Tier ranks: ITEM_AUTO > VENDOR_OFFER > ITEM_SUGGESTED > REQUEST_HISTORY > ITEM_FUZZY.
export async function searchAdvanced(
  q: string,
  options: SearchAdvancedOptions = {},
): Promise<AdvancedSearchResponse> {
  const qs = buildQuery({
    q,
    minScore: options.minScore,
    limit: options.limit,
    offset: options.offset,
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
    body: {
      rows,
      minScore: options.minScore,
      autoCreate: options.autoCreate,
    } satisfies MatchRowsInput,
  })
}

export async function listVendors(itemId: number): Promise<ItemVendorRow[]> {
  return apiRequest<ItemVendorRow[]>({ path: `/items/${itemId}/vendors` })
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

// The product's photos, cover first.
export async function listImages(id: number): Promise<ItemGallery> {
  return apiRequest<ItemGallery>({ path: `/items/${id}/images` })
}

// Add an uploaded photo.
export async function addImage(id: number, objectKey: string): Promise<void> {
  await apiRequest<void>({
    path: `/items/${id}/images`,
    method: "POST",
    body: { objectKey } satisfies ObjectKeyInput,
  })
}

export async function deleteImage(id: number, imageId: number): Promise<void> {
  await apiRequest<void>({ path: `/items/${id}/images/${imageId}`, method: "DELETE" })
}

export async function setCoverImage(id: number, imageId: number): Promise<void> {
  await apiRequest<void>({ path: `/items/${id}/images/${imageId}/cover`, method: "PUT" })
}

// Line defaults per item.
// Vendor, harga beli and harga jual a quotation line starts from; see
// fn_recommend_lines. A client id prefers that client's own history.
export async function recommend(
  itemIds: number[],
  clientId?: number,
): Promise<LineRecommendation[]> {
  const qs = new URLSearchParams({ itemIds: itemIds.join(",") })
  if (clientId) qs.set("clientId", String(clientId))
  return apiRequest<LineRecommendation[]>({ path: `/items/recommendations?${qs}` })
}

// The newest quotations, newest first.
export async function listRecentQuotations(id: number): Promise<ItemQuotationRow[]> {
  return apiRequest<ItemQuotationRow[]>({ path: `/items/${id}/quotations` })
}
