import type { LineRecommendation } from "@/types/api"
import type { ProductAddFormData, VendorOption } from "./helpers"

// A vendor from the search.
type SearchedVendor = { id: number; name: string }

// Linked vendors, then the rest.
//
// The item's own vendors come first, cheapest first and unpriced last, since
// they carry a harga beli. Any other active vendor found by the search
// follows, so a vendor the item was never linked to can still be picked;
// the server links it when the quotation is saved.
export function mergeVendorOptions(
  linked: VendorOption[],
  searched: SearchedVendor[],
): VendorOption[] {
  const priced = [...linked].sort((a, b) => {
    if (a.harga > 0 && b.harga > 0) return a.harga - b.harga
    return Number(b.harga > 0) - Number(a.harga > 0)
  })
  const seen = new Set(priced.map((v) => v.vendorId))
  const others = searched
    .filter((v) => !seen.has(v.id))
    .map((v) => ({ nama: v.name, harga: 0, vendorId: v.id }))
  return [...priced, ...others]
}

// Linked vendors plus saved ones.
//
// The line's saved vendor stays pickable before the item's vendors load. A
// vendor the item links wins over its saved copy. A saved link names the
// saved product only, so once the product changes the saved vendor goes by
// vendorId and the server links it to the new product.
export function withSavedVendors(
  linked: VendorOption[],
  saved: VendorOption[],
  sameItem: boolean,
): VendorOption[] {
  const known = new Set(linked.map((v) => v.vendorId))
  const extra = saved
    .filter((v) => !known.has(v.vendorId))
    .map((v) => (sameItem ? v : { nama: v.nama, harga: v.harga, vendorId: v.vendorId }))
  return [...linked, ...extra]
}

// Whole rupiah from a decimal.
function rupiah(v: string): string {
  const n = Number(v)
  return Number.isFinite(n) ? String(Math.round(n)) : ""
}

// Form fields a recommendation sets.
// Only what it knows: no vendor leaves the vendor empty, and an item never
// sold leaves harga jual for the user.
export function recommendationFields(rec: LineRecommendation): Partial<ProductAddFormData> {
  const out: Partial<ProductAddFormData> = {}
  if (rec.vendorName && rec.vendorId !== undefined) {
    out.namaVendor = rec.vendorName
    out.vendorId = rec.vendorId
    out.vendorProductId = rec.vendorProductId
  }
  if (rec.costPrice) out.hargaBeli = rupiah(rec.costPrice)
  if (rec.sellingPrice) out.hargaJual = rupiah(rec.sellingPrice)
  return out
}

// Form fields at pick time.
export type AutofillBase = Pick<ProductAddFormData, "namaVendor" | "hargaBeli" | "hargaJual">

// Fill only untouched fields.
//
// A recommendation can land after the user already chose a vendor or typed
// a price (a slow request, or retries). Each field it brings is applied only
// while it still holds the value it had when the product was picked; the
// vendor's ids move with its name. applied says which prices were set, so
// only those change the price-confirmation baseline.
export function applyUntouched(
  form: ProductAddFormData,
  base: AutofillBase,
  fields: Partial<ProductAddFormData>,
): { form: ProductAddFormData; applied: { beli: boolean; jual: boolean } } {
  const next = { ...form }
  if (fields.namaVendor !== undefined && form.namaVendor === base.namaVendor) {
    next.namaVendor = fields.namaVendor
    next.vendorId = fields.vendorId
    next.vendorProductId = fields.vendorProductId
  }
  const beli = form.hargaBeli === base.hargaBeli ? fields.hargaBeli : undefined
  const jual = form.hargaJual === base.hargaJual ? fields.hargaJual : undefined
  if (beli !== undefined) next.hargaBeli = beli
  if (jual !== undefined) next.hargaJual = jual
  return { form: next, applied: { beli: beli !== undefined, jual: jual !== undefined } }
}
