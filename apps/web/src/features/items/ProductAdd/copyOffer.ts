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

// What the copy did.
export function copyNote(source: string): string {
  return source === "CREATED"
    ? "Produk baru ditambahkan ke katalog."
    : "Memakai produk katalog yang sama."
}

// Near-exact names only.
// A looser match would offer a look-alike part the client did not ask for.
export const COPY_MIN_SCORE = 0.95
