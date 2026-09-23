import type { ProductItem } from "@/features/quotations/QuotationEdit"
import type { ProductRow, ShippingRow } from "@/features/quotations/types"
import { formatDateTime, formatRupiah, toNum } from "@/lib/format"
import type {
  PoItemInput,
  PoStatusEvent,
  PurchaseOrderItemRow,
  PurchaseOrderRow,
} from "@/types/api"
import { PO_LABEL } from "./PurchaseOrderDetail/helpers"
import type { PoRow } from "./types"

// Product row with catalogue ids.
export type PoProductRow = ProductRow & { itemId?: number; vendorId?: number }

// Map snapshot product items.
export function poItemsToProducts(items: PurchaseOrderItemRow[] | undefined): PoProductRow[] {
  if (!items) return []
  return items
    .filter((it) => it.itemType === "product")
    .map((it) => {
      const qty = toNum(it.qty)
      const sell = toNum(it.sellingPrice)
      const cost = toNum(it.costPrice)
      return {
        itemId: it.offeredItemId,
        vendorId: it.vendorId,
        vendor: it.vendorName,
        kode: it.itemCode ?? "",
        nama: it.itemName,
        qty,
        satuan: it.unitCode ?? "",
        hargaSatuan: sell,
        profitSatuan: sell - cost,
      }
    })
}

// Map snapshot shipping line.
export function poItemsToShipping(items: PurchaseOrderItemRow[] | undefined): ShippingRow {
  const ship = items?.find((it) => it.itemType === "shipping")
  if (!ship) return { nama: "Pengiriman", deadline: "", hargaSatuan: 0, alamat: "" }
  return {
    nama: ship.itemName,
    deadline: "",
    hargaSatuan: toNum(ship.sellingPrice),
    alamat: ship.shipDestination ?? "",
    hari: ship.shippingDays,
  }
}

// List row from the API.
export function poRowFromBackend(po: PurchaseOrderRow): PoRow {
  return {
    id: po.id,
    quotationId: po.quotationId,
    quotationNo: po.quotationNo,
    poNumber: po.poNumber,
    poDate: po.poDate.slice(0, 10),
    companyClientId: po.companyClientId,
    client: po.companyName,
    date: po.poDate,
    // The PO's own total, which the invoice bills
    total: formatRupiah(po.poGrandTotal),
    status: po.status,
    rowVersion: po.rowVersion,
    deliveryNoteNumber: po.deliveryNoteNumber,
    fileName: po.fileName,
    objectKey: po.objectKey,
  }
}

type PoDetails = { poNumber: string; poDate: string }

// Skip the details write when unchanged.
//
// Once the invoice is filed the server refuses any details write, even one
// that repeats the stored values, so a file-only upload must not send it.
export function detailsChanged(row: Pick<PoRow, "poNumber" | "poDate">, next: PoDetails): boolean {
  return next.poNumber.trim() !== row.poNumber.trim() || next.poDate !== row.poDate.slice(0, 10)
}

// Stored line, resent when untouched.
export type PoLineSource = {
  quotationItemId?: number
  offeredItemId?: number
  itemName: string
  itemCode?: string
  qty: string
  unitId?: number
  sellingPrice: string
  costPrice?: string
  isAvailable: boolean
  shipDestination?: string
}

// Wizard row plus its stored line.
export type PoEditLine = ProductItem & {
  quotationItemId?: number
  // Absent on a line added in the wizard
  source?: PoLineSource
  // Set once the line is edited
  touched?: boolean
}

// Wizard rows from stored lines.
export function poLinesToEdit(
  items: PurchaseOrderItemRow[],
  unitCode: (unitId?: number) => string,
): PoEditLine[] {
  return items
    .filter((it) => it.itemType === "product")
    .map((it) => {
      const sell = toNum(it.sellingPrice)
      return {
        id: it.id,
        quotationItemId: it.quotationItemId,
        itemId: it.offeredItemId,
        vendorId: it.vendorId,
        nama: it.itemName,
        kodeImpa: it.itemCode ?? "",
        requestedNama: it.itemName,
        requestedKodeImpa: it.itemCode ?? "",
        vendor: it.vendorName ?? "",
        jumlah: toNum(it.qty),
        satuan: it.unitCode ?? unitCode(it.unitId),
        // Unknown cost shows as 0 but is never sent as 0
        hargaBeli: toNum(it.costPrice),
        hargaJual: sell,
        source: {
          quotationItemId: it.quotationItemId,
          offeredItemId: it.offeredItemId,
          itemName: it.itemName,
          itemCode: it.itemCode,
          qty: it.qty,
          unitId: it.unitId,
          sellingPrice: it.sellingPrice,
          costPrice: it.costPrice,
          isAvailable: it.isAvailable,
          shipDestination: it.shipDestination,
        },
      }
    })
}

function unitIdOf(line: PoEditLine, unitIdByCode: Map<string, number>): number | undefined {
  const code = line.satuan.trim().toUpperCase()
  if (code === "") return line.source?.unitId
  return unitIdByCode.get(code)
}

// Save payload line.
//
// An untouched line goes back exactly as stored, so a quantity edit
// elsewhere cannot reset its availability, destination, unit or unknown
// cost. An edited line keeps the stored fields the wizard cannot show.
export function lineToInput(line: PoEditLine, unitIdByCode: Map<string, number>): PoItemInput {
  const s = line.source
  if (s && !line.touched) return { ...s }
  const costUnknown = s !== undefined && s.costPrice === undefined && line.hargaBeli === 0
  return {
    quotationItemId: s?.quotationItemId ?? line.quotationItemId,
    offeredItemId: line.itemId,
    itemName: line.nama || line.requestedNama,
    itemCode: line.kodeImpa || undefined,
    qty: String(line.jumlah),
    unitId: unitIdOf(line, unitIdByCode),
    sellingPrice: String(line.hargaJual),
    costPrice: costUnknown ? undefined : String(line.hargaBeli),
    isAvailable: s?.isAvailable,
    shipDestination: s?.shipDestination,
  }
}

// Edited lines whose unit is unknown.
//
// A stored line with no unit may stay that way; an edited or new line must
// name a unit the catalogue knows.
export function linesMissingUnit(lines: PoEditLine[], unitIdByCode: Map<string, number>): string[] {
  return lines
    .filter((l) => !l.source || l.touched)
    .filter((l) => {
      if (l.source && l.source.unitId === undefined && l.satuan.trim() === "") return false
      return unitIdOf(l, unitIdByCode) === undefined
    })
    .map((l) => l.nama || l.requestedNama)
}

// Fixed note on the creation row.
const CREATED_NOTE = "PO dibuat"

// Timeline entry for one event.
//
// The actor is a name when the viewer may list users, else the id.
export function poHistoryEntry(
  ev: PoStatusEvent,
  actorName?: string,
): { date: string; action: string } {
  const to = PO_LABEL[ev.toStatus]
  const note = ev.note?.trim()
  let action: string
  if (ev.fromStatus) {
    const move = `${PO_LABEL[ev.fromStatus]} → ${to}`
    action = note ? `${move}: ${note}` : move
  } else {
    action = note && note !== CREATED_NOTE ? `${to}: ${note}` : `Dibuat sebagai ${to}`
  }
  const who = actorName ?? `Pengguna #${ev.changedBy}`
  return { date: `${formatDateTime(ev.changedAt)} · ${who}`, action }
}
