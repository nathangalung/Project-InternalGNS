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
