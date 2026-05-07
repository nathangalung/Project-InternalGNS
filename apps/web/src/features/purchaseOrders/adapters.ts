import type { ProductRow, ShippingRow } from "@/features/quotations/types"
import type { PurchaseOrderItemRow } from "@/types/api"

// Numeric coerce, NaN-safe.
function toNum(v: string | undefined | null): number {
  if (v == null) return 0
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

// Map snapshot product items.
export function poItemsToProducts(
  items: PurchaseOrderItemRow[] | undefined,
): ProductRow[] {
  if (!items) return []
  return items
    .filter(it => it.itemType === "product")
    .map(it => {
      const qty = toNum(it.qty)
      const sell = toNum(it.sellingPrice)
      const cost = toNum(it.costPrice)
      return {
        kode: it.itemCode ?? "",
        nama: it.itemName,
        qty,
        satuan: it.unitCode ?? "",
        hargaSatuan: sell,
        profitSatuan: sell - cost,
      }
    })
}

// Map first shipping snapshot row.
export function poItemsToShipping(
  items: PurchaseOrderItemRow[] | undefined,
): ShippingRow {
  const ship = items?.find(it => it.itemType === "shipping")
  if (!ship) return { nama: "", deadline: "", hargaSatuan: 0 }
  return {
    nama: ship.itemName,
    deadline: "",
    hargaSatuan: toNum(ship.sellingPrice) * toNum(ship.qty),
    alamat: ship.shipDestination ?? undefined,
  }
}
