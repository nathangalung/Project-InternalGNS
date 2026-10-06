import { splitOffer } from "@/features/quotations/wizard"
import type { MatchedItemWithVendor, MatchRowInput } from "@/types/generated"
import type { CatalogItem } from "./helpers"

// Request label as a match row.
// The label is "code - name" or free text, as formatKodeNama writes it.
export function copyRow(label: string, qty: string, unit: string): MatchRowInput {
  const { kode, nama } = splitOffer(label)
  const n = Number(qty)
  return { impaCode: kode, name: nama, qty: Number.isFinite(n) ? n : 0, unit }
}

// Matched item as a catalog pick.
export function matchedCatalog(m: MatchedItemWithVendor): CatalogItem {
  return { id: m.itemId, kode: m.impaCode ?? "", nama: m.itemName, defaultUnitId: m.defaultUnitId }
}

// Match sources that name the same item.
const EXACT_SOURCES = new Set(["IMPA_EXACT", "LEARNED_EXACT"])

// What the copy did.
// A look-alike match is the Excel import's own rule, so the user is asked
// to check it before saving.
export function copyNote(source: string): string {
  if (source === "CREATED") return "Produk baru ditambahkan ke katalog."
  if (EXACT_SOURCES.has(source)) return "Memakai produk katalog yang sama."
  return "Memakai produk katalog yang paling mirip. Periksa sebelum disimpan."
}
