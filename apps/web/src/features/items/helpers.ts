import { ApiError } from "@/lib/api-client"
import type {
  AdvancedSearchHit,
  AdvancedSearchResponse,
  AdvancedSearchTier,
  ItemRow,
} from "@/types/api"

// Unit-filtered search scan size.
//
// search-advanced takes no unit filter, so with one set the Katalog reads the
// top hits at the server's limit clamp and filters and pages them here.
export const KATALOG_UNIT_SCAN_LIMIT = 200

// Fields the katalog table shows.
export type KatalogRow = Pick<ItemRow, "id" | "name" | "impaCode" | "defaultUnitId" | "isActive">

// Search hits as table rows.
export function katalogRowsFromHits(hits: AdvancedSearchHit[]): KatalogRow[] {
  return hits.map((h) => ({
    id: h.id,
    name: h.name,
    impaCode: h.impaCode,
    defaultUnitId: h.defaultUnitId,
    isActive: h.isActive,
  }))
}

// What the Katalog asks for.
export type KatalogSearchPlan = {
  limit: number
  offset: number
  // Unit filter pages here
  clientPage: boolean
}

// Server page, or unit scan.
export function katalogSearchPlan(
  unitId: number | undefined,
  startIndex: number,
  itemsPerPage: number,
): KatalogSearchPlan {
  if (unitId === undefined) {
    return { limit: itemsPerPage, offset: startIndex, clientPage: false }
  }
  return { limit: KATALOG_UNIT_SCAN_LIMIT, offset: 0, clientPage: true }
}

export type KatalogSearchView = {
  // Hits on the current page
  hits: AdvancedSearchHit[]
  total: number
  counts: Partial<Record<AdvancedSearchTier, number>>
  // Only the scan was filtered
  capped: boolean
}

// Page, total and tier counts.
export function katalogSearchView(
  data: AdvancedSearchResponse | undefined,
  plan: KatalogSearchPlan,
  unitId: number | undefined,
  startIndex: number,
  itemsPerPage: number,
): KatalogSearchView {
  if (!data) return { hits: [], total: 0, counts: {}, capped: false }
  if (!plan.clientPage) {
    return { hits: data.hits, total: data.total, counts: data.counts, capped: false }
  }
  const matched = data.hits.filter((h) => h.defaultUnitId === unitId)
  const counts: Partial<Record<AdvancedSearchTier, number>> = {}
  for (const h of matched) counts[h.tier] = (counts[h.tier] ?? 0) + 1
  return {
    hits: matched.slice(startIndex, startIndex + itemsPerPage),
    total: matched.length,
    counts,
    capped: data.total > data.hits.length,
  }
}

// Two-letter product initials.
export function productInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "?"
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

// Vendor initials, PT dropped.
export function vendorInitials(name: string): string {
  const out = name
    .replace(/^PT\.?\s+/i, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase()
  return out || "?"
}

// One field from a problem body.
export function apiFieldError(err: unknown, key: string): string | undefined {
  if (!(err instanceof ApiError) || !err.body || typeof err.body !== "object") return undefined
  const fields = (err.body as { fields?: unknown }).fields
  if (!fields || typeof fields !== "object") return undefined
  const v = (fields as Record<string, unknown>)[key]
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined
}

export type AddVendorError = { field?: string; form?: string }

// Add-vendor failure placement.
//
// An inactive vendor comes back as 422 on fields.vendorId, an unknown one as
// 404; both belong under the vendor picker. Anything else is a form error.
export function addVendorError(err: unknown): AddVendorError {
  const field = apiFieldError(err, "vendorId")
  if (field) return { field }
  if (err instanceof ApiError && err.status === 404) {
    return { field: "Vendor tidak ditemukan. Pilih vendor lain." }
  }
  const msg = err instanceof Error ? err.message.trim() : ""
  return { form: msg || "Gagal menambah vendor." }
}

// Exact name match, any case.
export function findVendorByName<T extends { name: string }>(
  rows: readonly T[],
  name: string,
): T | undefined {
  const target = name.trim().toLocaleLowerCase("id-ID")
  if (!target) return undefined
  return rows.find((r) => r.name.trim().toLocaleLowerCase("id-ID") === target)
}
