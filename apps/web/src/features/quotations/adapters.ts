import type { ProductRow, QuotationData, ShippingRow, Status } from "@/features/quotations/types"
import { formatDate, formatDateTime, formatNumber } from "@/lib/format"
import { statusToLabel } from "@/lib/status"
import type {
  QuotationDetail as ApiQuotationDetail,
  QuotationItemRow as ApiQuotationItem,
  QuotationListRow as ApiQuotationRow,
  QuotationStatusEvent as ApiStatusEvent,
} from "@/types/api"
import type { QuotationRow } from "./QuotationList/helpers"

// Expired displays as rejected.
function collapseExpiredToRejected(label: ReturnType<typeof statusToLabel>): Status {
  return label === "Kadaluarsa" ? "Ditolak" : label
}

function actionFromEvent(ev: ApiStatusEvent): string {
  const label = statusToLabel(ev.toStatus)
  return ev.note ? `Status diubah menjadi ${label}: ${ev.note}` : `Status diubah menjadi ${label}`
}

function toProductRow(it: ApiQuotationItem, unitName: string): ProductRow {
  const sell = Number(it.sellingPrice)
  const cost = it.costPrice !== undefined ? Number(it.costPrice) : 0
  return {
    kode: it.requestedImpa ?? "",
    nama: it.requestedName,
    requestedKode: it.requestedImpa ?? "",
    requestedNama: it.requestedName,
    qty: Number(it.qty),
    satuan: unitName,
    hargaSatuan: Number.isFinite(sell) ? sell : 0,
    profitSatuan: Number.isFinite(sell) && Number.isFinite(cost) ? sell - cost : 0,
  }
}

function toShipping(items: ApiQuotationItem[]): ShippingRow {
  const ship = items.find((i) => i.itemType === "shipping")
  if (!ship) return { nama: "", deadline: "", hargaSatuan: 0 }
  const cost = Number(ship.sellingPrice)
  return {
    nama: ship.requestedName,
    deadline: "",
    hargaSatuan: Number.isFinite(cost) ? cost : 0,
    alamat: ship.shipDestination,
    hari: undefined,
  }
}

// API detail to view model.
export function toQuotationData(
  api: ApiQuotationDetail,
  unitOf: (id?: number) => string,
): QuotationData {
  const products = api.items
    .filter((i) => i.itemType === "product")
    .map((i) => toProductRow(i, unitOf(i.unitId)))
  const shipping = toShipping(api.items)
  const grandTotal = Number(api.grandTotal)
  const subtotal = Number(api.subtotal)
  const dpp = Number(api.dppNilaiLain)
  const ppn = Number(api.ppnAmount)
  const totalDiscount = Number(api.totalDiscount)
  const discount = Number(api.discountPct)
  const status = collapseExpiredToRejected(statusToLabel(api.status))
  return {
    id: String(api.id),
    version: api.version,
    client: api.companyClientName,
    clientInfo: {
      narahubung: api.contactName,
      referenceNumber: api.clientRefNo,
    },
    createdAt: formatDateTime(api.createdAt),
    status,
    totalBayar: Number.isFinite(grandTotal) ? grandTotal : 0,
    subtotal: Number.isFinite(subtotal) ? subtotal : 0,
    dppNilaiLain: Number.isFinite(dpp) ? dpp : 0,
    ppnAmount: Number.isFinite(ppn) ? ppn : 0,
    totalDiscount: Number.isFinite(totalDiscount) ? totalDiscount : 0,
    discountPct: Number.isFinite(discount) ? discount : 0,
    products,
    shipping,
    history: api.history.map((ev) => ({
      date: formatDateTime(ev.changedAt),
      action: actionFromEvent(ev),
    })),
  }
}

// API row to table row.
export function toTableRow(api: ApiQuotationRow): QuotationRow {
  const grand = Number(api.grandTotal)
  const hargaBeli = Number(api.totalHargaBeli)
  return {
    id: String(api.id),
    displayNo: api.quotationNo,
    version: api.version,
    client: api.companyName,
    date: formatDate(api.createdAt),
    hargaBeli: Number.isFinite(hargaBeli) ? formatNumber(hargaBeli) : api.totalHargaBeli,
    total: Number.isFinite(grand) ? formatNumber(grand) : api.grandTotal,
    status: collapseExpiredToRejected(statusToLabel(api.status)),
  }
}
