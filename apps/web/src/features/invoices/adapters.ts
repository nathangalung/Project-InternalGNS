import type { ProductRow, ShippingRow } from "@/features/quotations/types"
import type { InvoiceItemRow } from "@/types/api"

function toNum(v: string | undefined | null): number {
  if (v == null) return 0
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

// Map snapshot product items.
export function invoiceItemsToProducts(items: InvoiceItemRow[] | undefined): ProductRow[] {
  if (!items) return []
  return items
    .filter((it) => it.lineType === "product")
    .map((it) => {
      const qty = toNum(it.qty)
      const price = toNum(it.unitPrice)
      const cost = toNum(it.costPrice)
      return {
        kode: it.itemCode ?? "",
        nama: it.itemName,
        qty,
        satuan: it.unitCode ?? "",
        hargaSatuan: price,
        profitSatuan: price - cost,
      }
    })
}

// Map first shipping snapshot row.
export function invoiceItemsToShipping(items: InvoiceItemRow[] | undefined): ShippingRow {
  const ship = items?.find((it) => it.lineType === "shipping")
  if (!ship) return { nama: "", deadline: "", hargaSatuan: 0 }
  return {
    nama: ship.itemName,
    deadline: "",
    hargaSatuan: toNum(ship.unitPrice) * toNum(ship.qty),
    alamat: ship.shipDestination ?? undefined,
  }
}
