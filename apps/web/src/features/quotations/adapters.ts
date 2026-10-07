import type { ProductRow, QuotationData, ShippingRow } from "@/features/quotations/types"
import { formatDate, formatDateTime, formatNumber } from "@/lib/format"
import type {
  QuotationDetail as ApiQuotationDetail,
  QuotationItemRow as ApiQuotationItem,
  QuotationListRow as ApiQuotationRow,
  QuotationStatusEvent as ApiStatusEvent,
  QuotationItemInput,
} from "@/types/api"
import { parseQty, requestedCode } from "./lines"
import type { QuotationRow } from "./QuotationList/helpers"
import { quotationStatusLabel } from "./status"
import type { ProductItem } from "./wizard"

// Status history entry text.
//
// Creation carries a fixed server note, so only the status is shown.
export function historyAction(ev: ApiStatusEvent): string {
  const to = quotationStatusLabel(ev.toStatus)
  if (!ev.fromStatus) return `Dibuat sebagai ${to}`
  const move = `${quotationStatusLabel(ev.fromStatus)} → ${to}`
  return ev.note ? `${move}: ${ev.note}` : move
}

// History date, system moves marked.
//
// A move with no acting user reads Sistem.
export function historyDate(ev: ApiStatusEvent): string {
  const date = formatDateTime(ev.changedAt)
  return ev.changedBy === null ? `${date} · Sistem` : date
}

// Offered item, else the request.
function offered(it: ApiQuotationItem): { kode: string; nama: string } {
  return {
    kode: it.offeredImpa ?? it.requestedImpa ?? "",
    nama: it.offeredName ?? it.requestedName,
  }
}

// API line to wizard product.
//
// Shows the offered item like the detail does; the request stays alongside
// and is what toItemInput sends back.
export function toWizardProduct(
  it: ApiQuotationItem,
  fallbackId: number,
  unitName: string,
): ProductItem {
  const sell = Number(it.sellingPrice)
  const cost = it.costPrice !== undefined ? Number(it.costPrice) : 0
  const { kode, nama } = offered(it)
  return {
    id: it.id ?? fallbackId,
    itemId: it.offeredItemId ?? it.requestedItemId,
    requestedItemId: it.requestedItemId,
    vendorId: it.vendorId,
    vendorProductId: it.vendorProductId,
    nama,
    kodeImpa: kode,
    requestedNama: it.requestedName,
    requestedKodeImpa: it.requestedImpa ?? "",
    vendor: it.vendorName ?? "",
    jumlah: parseQty(it.qty),
    satuan: unitName,
    hargaBeli: Number.isFinite(cost) ? cost : 0,
    hargaJual: Number.isFinite(sell) ? sell : 0,
    noOffer: it.itemType === "product" && !it.isAvailable ? true : undefined,
  }
}

// Wizard line to API.
//
// Add and edit share it, so a stored request round-trips unchanged and the
// IMPA saved is the one the request block shows (see requestedCode). A
// vendor picked without a link travels as vendorId and the server links it
// (fn_prepare_quotation_lines); a Tidak Ditawarkan line goes out unpriced. A
// role that sets no price (pricing false) sends no harga jual; the server
// keeps the stored one.
export function toItemInput(p: ProductItem, unitId: number, pricing = true): QuotationItemInput {
  const base = {
    requestedItemId: p.requestedItemId,
    requestedImpa: requestedCode(p) || undefined,
    requestedName: p.requestedNama || p.nama,
    offeredItemId: p.itemId,
    qty: String(p.jumlah),
    unitId,
  }
  if (p.noOffer) return { ...base, sellingPrice: "0", isAvailable: false }
  return {
    ...base,
    vendorProductId: p.vendorProductId,
    vendorId: p.vendorProductId === undefined ? p.vendorId : undefined,
    sellingPrice: pricing ? String(p.hargaJual) : undefined,
    costPrice: String(p.hargaBeli),
  }
}

function toProductRow(it: ApiQuotationItem, unitName: string): ProductRow {
  const sell = Number(it.sellingPrice)
  const cost = it.costPrice !== undefined ? Number(it.costPrice) : 0
  const { kode, nama } = offered(it)
  return {
    itemId: it.offeredItemId ?? it.requestedItemId,
    lineId: it.id,
    kode,
    nama,
    requestedKode: it.requestedImpa ?? "",
    requestedNama: it.requestedName,
    qty: Number(it.qty),
    satuan: unitName,
    hargaSatuan: Number.isFinite(sell) ? sell : 0,
    profitSatuan: Number.isFinite(sell) && Number.isFinite(cost) ? sell - cost : 0,
    vendor: it.vendorName,
    vendorId: it.vendorId,
    storeUrl: it.productUrl,
    noOffer: !it.isAvailable,
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
    hari: ship.shippingDays,
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
  const status = quotationStatusLabel(api.status)
  return {
    id: String(api.id),
    seesSelling: api.grandTotal !== undefined,
    version: api.version,
    client: api.companyClientName,
    clientId: api.companyClientId,
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
    ppnEnabled: api.ppnEnabled,
    totalDiscount: Number.isFinite(totalDiscount) ? totalDiscount : 0,
    discountPct: Number.isFinite(discount) ? discount : 0,
    products,
    shipping,
    history: api.history.map((ev) => ({
      date: historyDate(ev),
      action: historyAction(ev),
    })),
  }
}

// Money text, absent when hidden.
function moneyText(v: string | undefined): string | undefined {
  if (v === undefined) return undefined
  const n = Number(v)
  return Number.isFinite(n) ? formatNumber(n) : v
}

// API row to table row.
export function toTableRow(api: ApiQuotationRow): QuotationRow {
  return {
    id: String(api.id),
    displayNo: api.quotationNo,
    version: api.version,
    client: api.companyName,
    clientId: api.companyClientId,
    date: formatDate(api.createdAt),
    hargaBeli: moneyText(api.totalHargaBeli),
    total: moneyText(api.grandTotal),
    status: quotationStatusLabel(api.status),
  }
}
