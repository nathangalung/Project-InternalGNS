import { ApiError } from "@/lib/api-client"
import type { AdvancedSearchHit, ItemRow, Role } from "@/types/api"

// Catalog write access.
//
// The API refuses every item write from finance with 403, so finance gets a
// read-only catalog. An unknown role is read-only too.
export function canWriteCatalog(role: Role | undefined): boolean {
  return role === "superadmin" || role === "operational"
}

// Katalog search page size.
//
// search-advanced has no offset or total; it returns at most this many hits,
// which is the server's clamp for any limit.
export const KATALOG_SEARCH_LIMIT = 200

// Server may hold more.
export function isSearchCapped(hitCount: number, limit: number): boolean {
  return limit > 0 && hitCount >= limit
}

// Fields the katalog table shows.
export type KatalogRow = Pick<ItemRow, "id" | "name" | "impaCode" | "defaultUnitId" | "isActive">

// Search hits as table rows.
export function katalogRowsFromHits(hits: AdvancedSearchHit[], unitId?: number): KatalogRow[] {
  const rows = hits.map((h) => ({
    id: h.id,
    name: h.name,
    impaCode: h.impaCode,
    defaultUnitId: h.defaultUnitId,
    isActive: h.isActive,
  }))
  return unitId === undefined ? rows : rows.filter((r) => r.defaultUnitId === unitId)
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
