import { apiRequest } from "@/lib/api-client"
import { applyOverride, applyOverrides, setOverride } from "@/lib/local-overrides"
import type { VendorItemRow, VendorRow, VendorSearchHit } from "@/types/api"

const OVERRIDE_KEY = "gns_vendors_overrides_v1"

export async function list(params: { limit?: number; offset?: number } = {}): Promise<VendorRow[]> {
  const search = new URLSearchParams()
  if (params.limit !== undefined) search.set("limit", String(params.limit))
  if (params.offset !== undefined) search.set("offset", String(params.offset))
  const qs = search.toString()
  const rows = await apiRequest<VendorRow[]>({ path: `/vendors${qs ? `?${qs}` : ""}` })
  return applyOverrides(rows, OVERRIDE_KEY)
}

export async function get(id: number): Promise<VendorRow> {
  const row = await apiRequest<VendorRow>({ path: `/vendors/${id}` })
  return applyOverride(row, OVERRIDE_KEY)
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
  contactInfo?: unknown
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
  contactInfo?: unknown
  isActive: boolean
}

// No PATCH endpoint; persist override locally.
export async function update(id: number, input: UpdateVendorInput): Promise<VendorRow> {
  const current = await apiRequest<VendorRow>({ path: `/vendors/${id}` })
  const merged: VendorRow = { ...current, ...input, updatedAt: new Date().toISOString() }
  setOverride<VendorRow>(OVERRIDE_KEY, id, {
    ...input,
    updatedAt: merged.updatedAt,
  })
  return merged
}
