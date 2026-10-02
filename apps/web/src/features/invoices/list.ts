import { resolveRange } from "@/lib/date-range"
import { formatRupiah } from "@/lib/format"
import type { InvoiceBackendRow, InvoiceBackendStatus } from "@/types/api"
import type { ListParams } from "./api"
import { invoiceDisplayStatus } from "./InvoiceDetail/helpers"
import type { InvoiceFilterValues } from "./InvoiceFilter"
import type { InvoiceDisplayStatus, InvoiceRow } from "./types"

// Filter status to effective status.
const STATUS_TO_EFFECTIVE: Record<InvoiceDisplayStatus, InvoiceBackendStatus> = {
  DRAF: "draft",
  DIKIRIM: "sent",
  DIBAYAR: "paid",
  TERLAMBAT: "overdue",
  DIBATALKAN: "cancelled",
}

// Every live status.
//
// Sent when no status is picked, so the server leaves cancelled invoices out
// and X-Total-Count matches the rows shown. A cancelled invoice is listed
// only when Dibatalkan is picked.
const LIVE_EFFECTIVE_STATUSES = "draft,sent,paid,overdue"

function rupiahToDigits(s: string): string {
  return s.replace(/\D/g, "")
}

// List query from the screen state.
export function invoiceListParams(
  search: string,
  filters: InvoiceFilterValues | null,
  itemsPerPage: number,
  startIndex: number,
): ListParams {
  const out: ListParams = {
    q: search || undefined,
    limit: itemsPerPage,
    offset: startIndex,
    sortBy: "createdAt",
    sortDir: "desc",
    effectiveStatus: LIVE_EFFECTIVE_STATUSES,
  }
  if (!filters) return out
  if (filters.statuses.length > 0) {
    out.effectiveStatus = filters.statuses.map((s) => STATUS_TO_EFFECTIVE[s]).join(",")
  }
  const created = resolveRange(filters.createdPreset, filters.createdStart, filters.createdEnd)
  if (created.start) out.dateFrom = created.start
  if (created.end) out.dateTo = created.end
  const due = resolveRange(filters.duePreset, filters.dueStart, filters.dueEnd)
  if (due.start) out.dueFrom = due.start
  if (due.end) out.dueTo = due.end
  const min = rupiahToDigits(filters.minHarga)
  if (min && min !== "0") out.minTotal = min
  const max = rupiahToDigits(filters.maxHarga)
  if (max && max !== "0") out.maxTotal = max
  return out
}

function parseRupiahNumber(s: string | undefined): number {
  if (!s) return 0
  const n = Number(s)
  return Number.isFinite(n) ? n : 0
}

// API row to table row.
export function rowFromBackend(inv: InvoiceBackendRow): InvoiceRow {
  const totalNumber = parseRupiahNumber(inv.total ?? inv.subtotal)
  return {
    id: inv.id,
    quotationId: inv.quotationId,
    companyClientId: inv.companyClientId,
    invoiceNo: inv.invoiceNo,
    client: inv.companyName,
    createdAt: inv.invoiceDate,
    dueDate: inv.dueDate ?? inv.invoiceDate,
    total: formatRupiah(totalNumber),
    totalNumber,
    status: invoiceDisplayStatus(inv),
  }
}

// Detail route search for a row.
//
// The route keyed by quotation opens the newest invoice, which for a
// cancelled one may be its Pengganti, so a cancelled row names itself.
export function detailSearch(row: InvoiceRow): { invoiceId?: number } {
  return row.status === "DIBATALKAN" ? { invoiceId: row.id } : {}
}
