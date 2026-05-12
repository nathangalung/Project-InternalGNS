import { apiList, apiRequest, type PaginatedList } from "@/lib/api-client"
import type {
  AdvancedSearchResponse,
  ItemMatchHit,
  ItemPriceHistoryRow,
  ItemRow,
  ItemSearchHit,
  ItemVendorRow,
  MatchRowInput,
  MatchRowsResponse,
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
  const search = new URLSearchParams()
  if (params.q) search.set("q", params.q)
  if (params.isActive !== undefined) search.set("isActive", String(params.isActive))
  if (params.unitId !== undefined) search.set("unitId", String(params.unitId))
  if (params.sortBy) search.set("sortBy", params.sortBy)
  if (params.sortDir) search.set("sortDir", params.sortDir)
  if (params.limit !== undefined) search.set("limit", String(params.limit))
  if (params.offset !== undefined) search.set("offset", String(params.offset))
  const qs = search.toString()
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

export async function search(
  q: string,
  options: { minScore?: number; limit?: number } = {},
): Promise<ItemSearchHit[]> {
  const params = new URLSearchParams({ q })
  if (options.minScore !== undefined) params.set("minScore", String(options.minScore))
  if (options.limit !== undefined) params.set("limit", String(options.limit))
  return apiRequest<ItemSearchHit[]>({ path: `/items/search?${params.toString()}` })
}

// Multi-source search: items + vendor offers + request history.
// Tier ranks: ITEM_AUTO > VENDOR_OFFER > ITEM_SUGGESTED > REQUEST_HISTORY > ITEM_FUZZY.
export async function searchAdvanced(
  q: string,
  options: { minScore?: number; limit?: number } = {},
): Promise<AdvancedSearchResponse> {
  const params = new URLSearchParams({ q })
  if (options.minScore !== undefined) params.set("minScore", String(options.minScore))
  if (options.limit !== undefined) params.set("limit", String(options.limit))
  return apiRequest<AdvancedSearchResponse>({ path: `/items/search-advanced?${params.toString()}` })
}

export async function matchRequest(reqText: string, limit?: number): Promise<ItemMatchHit[]> {
  return apiRequest<ItemMatchHit[]>({
    path: "/items/match-request",
    method: "POST",
    body: { reqText, limit: limit ?? 5 },
  })
}

export async function matchRows(
  rows: MatchRowInput[],
  options: { minScore?: number } = {},
): Promise<MatchRowsResponse> {
  return apiRequest<MatchRowsResponse>({
    path: "/items/match-rows",
    method: "POST",
    body: { rows, minScore: options.minScore },
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
  const params = new URLSearchParams()
  if (options.limit !== undefined) params.set("limit", String(options.limit))
  const qs = params.toString()
  return apiRequest<ItemPriceHistoryRow[]>({
    path: `/items/${itemId}/price-history${qs ? `?${qs}` : ""}`,
  })
}

type CreateItemInput = {
  name: string
  impaCode?: string
  defaultUnitId?: number
  description?: string
}

export async function create(input: CreateItemInput): Promise<ItemRow> {
  return apiRequest<ItemRow>({
    path: "/items",
    method: "POST",
    body: input,
  })
}
