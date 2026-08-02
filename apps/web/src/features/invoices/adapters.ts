import type { ProductRow, ShippingRow } from "@/features/quotations/types"
import { toNum } from "@/lib/format"
import type { InvoiceItemRow } from "@/types/api"

// Map snapshot product items.
export function invoiceItemsToProducts(items: InvoiceItemRow[] | undefined): ProductRow[] {
  if (!items) return []
  return items
    .filter((it) => it.lineType === "product")
    .map((it) => {
      const qty = toNum(it.qty)
      // unitPrice is net of the line discount; show gross and let the
      // discount row carry it. Historical rows have no gross snapshot.
      const net = toNum(it.unitPrice)
      const gross = toNum(it.grossUnitPrice) || net
      const cost = toNum(it.costPrice)
      return {
        kode: it.itemCode ?? "",
        nama: it.itemName,
        qty,
        satuan: it.unitCode ?? "",
        hargaSatuan: gross,
        // Profit is realised on what is actually billed, i.e. the net price.
        profitSatuan: net - cost,
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
