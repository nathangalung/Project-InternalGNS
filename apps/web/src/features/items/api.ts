import { apiRequest } from "@/lib/api-client"
import type {
  ItemMatchHit,
  ItemPriceHistoryRow,
  ItemRow,
  ItemSearchHit,
  ItemVendorRow,
} from "@/types/api"

export async function list(params: { limit?: number; offset?: number } = {}): Promise<ItemRow[]> {
  const search = new URLSearchParams()
  if (params.limit !== undefined) search.set("limit", String(params.limit))
  if (params.offset !== undefined) search.set("offset", String(params.offset))
  const qs = search.toString()
  return apiRequest<ItemRow[]>({ path: `/items${qs ? `?${qs}` : ""}` })
}

export async function get(id: number): Promise<ItemRow> {
  return apiRequest<ItemRow>({ path: `/items/${id}` })
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

export async function matchRequest(reqText: string, limit?: number): Promise<ItemMatchHit[]> {
  return apiRequest<ItemMatchHit[]>({
    path: "/items/match-request",
    method: "POST",
    body: { reqText, limit: limit ?? 5 },
  })
}

export async function listVendors(itemId: number): Promise<ItemVendorRow[]> {
  return apiRequest<ItemVendorRow[]>({ path: `/items/${itemId}/vendors` })
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
