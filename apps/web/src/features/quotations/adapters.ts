import { statusToLabel } from "@/lib/status";
import type {
  ProductRow,
  QuotationData,
  ShippingRow,
  Status,
} from "@/features/quotations/types";
import type {
  QuotationDetail as ApiQuotationDetail,
  QuotationItemRow as ApiQuotationItem,
  QuotationListRow as ApiQuotationRow,
  QuotationStatusEvent as ApiStatusEvent,
} from "@/types/api";
import type { QuotationRow } from "./QuotationList/helpers";

// Expired displays as rejected.
function collapseExpiredToRejected(label: ReturnType<typeof statusToLabel>): Status {
  return label === "Kadaluarsa" ? "Ditolak" : label;
}

function formatRp(amount: number): string {
  return amount.toLocaleString("id-ID");
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const date = d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
  const time = d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
  return `${date}, ${time}`;
}

function actionFromEvent(ev: ApiStatusEvent): string {
  const label = statusToLabel(ev.toStatus);
  return ev.note ? `Status diubah menjadi ${label}: ${ev.note}` : `Status diubah menjadi ${label}`;
}

function toProductRow(it: ApiQuotationItem, unitName: string): ProductRow {
  const sell = Number(it.sellingPrice);
  const cost = it.costPrice !== undefined ? Number(it.costPrice) : 0;
  return {
    kode: it.requestedImpa ?? "",
    nama: it.requestedName,
    requestedKode: it.requestedImpa ?? "",
    requestedNama: it.requestedName,
    qty: Number(it.qty),
    satuan: unitName,
    hargaSatuan: Number.isFinite(sell) ? sell : 0,
    profitSatuan: Number.isFinite(sell) && Number.isFinite(cost) ? sell - cost : 0,
  };
}

function toShipping(items: ApiQuotationItem[]): ShippingRow {
  const ship = items.find((i) => i.itemType === "shipping");
  if (!ship) return { nama: "", deadline: "", hargaSatuan: 0 };
  const cost = Number(ship.sellingPrice);
  return {
    nama: ship.requestedName,
    deadline: "",
    hargaSatuan: Number.isFinite(cost) ? cost : 0,
    alamat: ship.shipDestination,
    hari: undefined,
  };
}

// API detail to view model.
export function toQuotationData(
  api: ApiQuotationDetail,
  unitOf: (id?: number) => string,
): QuotationData {
  const products = api.items.filter((i) => i.itemType === "product").map((i) => toProductRow(i, unitOf(i.unitId)));
  const shipping = toShipping(api.items);
  const total = Number(api.total);
  const discount = Number(api.discountPct);
  const status = collapseExpiredToRejected(statusToLabel(api.status));
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
    totalBayar: Number.isFinite(total) ? total : 0,
    discountPct: Number.isFinite(discount) ? discount : 0,
    products,
    shipping,
    history: api.history.map((ev) => ({
      date: formatDateTime(ev.changedAt),
      action: actionFromEvent(ev),
    })),
  };
}

// API row to table row.
export function toTableRow(api: ApiQuotationRow): QuotationRow {
  const total = Number(api.total);
  const hargaBeli = Number(api.totalHargaBeli);
  return {
    id: String(api.id),
    displayNo: api.quotationNo,
    version: api.version,
    client: api.companyName,
    date: formatDate(api.createdAt),
    hargaBeli: Number.isFinite(hargaBeli) ? formatRp(hargaBeli) : api.totalHargaBeli,
    total: Number.isFinite(total) ? formatRp(total) : api.total,
    status: collapseExpiredToRejected(statusToLabel(api.status)),
  };
}
