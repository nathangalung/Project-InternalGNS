import { apiRequest } from "@/lib/api-client"
import { applyOverride, applyOverrides, setOverride } from "@/lib/local-overrides"
import type {
  ItemMatchHit,
  ItemPriceHistoryRow,
  ItemRow,
  ItemSearchHit,
  ItemVendorRow,
} from "@/types/api"

const ITEM_OVERRIDE_KEY = "gns_items_overrides_v1"
const ITEM_VENDORS_KEY = "gns_item_vendors_local_v1"

export async function list(params: { limit?: number; offset?: number } = {}): Promise<ItemRow[]> {
  const search = new URLSearchParams()
  if (params.limit !== undefined) search.set("limit", String(params.limit))
  if (params.offset !== undefined) search.set("offset", String(params.offset))
  const qs = search.toString()
  const rows = await apiRequest<ItemRow[]>({ path: `/items${qs ? `?${qs}` : ""}` })
  return applyOverrides(rows, ITEM_OVERRIDE_KEY)
}

export async function get(id: number): Promise<ItemRow> {
  const row = await apiRequest<ItemRow>({ path: `/items/${id}` })
  return applyOverride(row, ITEM_OVERRIDE_KEY)
}

export type UpdateItemInput = {
  name: string
  impaCode?: string
  defaultUnitId?: number
  description?: string
  isActive: boolean
}

// No PATCH endpoint; store as override.
export async function update(id: number, input: UpdateItemInput): Promise<ItemRow> {
  const current = await apiRequest<ItemRow>({ path: `/items/${id}` })
  const merged: ItemRow = { ...current, ...input, updatedAt: new Date().toISOString() }
  setOverride<ItemRow>(ITEM_OVERRIDE_KEY, id, {
    ...input,
    updatedAt: merged.updatedAt,
  })
  return merged
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

// localStorage shape: { [itemId: number]: ItemVendorRow[] }  (locally-added rows only)
function readLocalVendors(): Record<string, ItemVendorRow[]> {
  try {
    const raw = localStorage.getItem(ITEM_VENDORS_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === "object") return parsed as Record<string, ItemVendorRow[]>
    return {}
  } catch {
    return {}
  }
}

function writeLocalVendors(store: Record<string, ItemVendorRow[]>) {
  localStorage.setItem(ITEM_VENDORS_KEY, JSON.stringify(store))
}

export async function listVendors(itemId: number): Promise<ItemVendorRow[]> {
  const remote = await apiRequest<ItemVendorRow[]>({ path: `/items/${itemId}/vendors` })
  const local = readLocalVendors()[String(itemId)] ?? []
  return [...remote, ...local]
}

export type AddVendorToItemInput = {
  vendorId: number
  vendorSku?: string
  costPrice?: string
}

// No POST endpoint for /items/:id/vendors; stash the new row in localStorage so
// the table updates immediately and persists on reload.
export async function addVendor(itemId: number, input: AddVendorToItemInput): Promise<ItemVendorRow> {
  const store = readLocalVendors()
  const existing = store[String(itemId)] ?? []

  // Look up vendor name so the row renders meaningfully.
  let vendorName = `Vendor #${input.vendorId}`
  try {
    const vendor = await apiRequest<{ name: string }>({ path: `/vendors/${input.vendorId}` })
    if (vendor?.name) vendorName = vendor.name
  } catch {
    // ignore — we'll show the placeholder name
  }

  // Synthetic vendorProductId; negative to avoid colliding with real ids.
  const minId = existing.reduce((m, r) => (r.vendorProductId < m ? r.vendorProductId : m), 0)
  const newRow: ItemVendorRow = {
    vendorProductId: Math.min(-1, minId - 1),
    vendorId: input.vendorId,
    vendorName,
    vendorSku: input.vendorSku,
    costPrice: input.costPrice,
    lastQuotedAt: new Date().toISOString(),
  }
  store[String(itemId)] = [...existing, newRow]
  writeLocalVendors(store)
  return newRow
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
