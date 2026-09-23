import { formatDate, formatNumber, formatRupiah, toNum } from "@/lib/format"
import { roleCanAccess, type Section } from "@/lib/rbac"
import {
  deriveInvoiceStatus,
  type InvoiceStatus,
  type QuotationStatusLabel,
  quotationBadge,
  quotationStatusLabel,
} from "@/lib/status"
import type { DashboardStatusCount, InvoiceBackendRow, QuotationListRow, Role } from "@/types/api"

// Overview card list targets.
const CARD_TARGETS = {
  invoices: { to: "/invoices", section: "invoices" },
  quotations: { to: "/quotations", section: "quotation" },
  purchaseOrders: { to: "/purchase-orders", section: "purchase-orders" },
} as const satisfies Record<string, { to: string; section: Section }>

export type CardKey = keyof typeof CARD_TARGETS
export type CardRoute = (typeof CARD_TARGETS)[CardKey]["to"]

// List route, or null.
//
// A card whose list the role cannot open stays a plain figure instead of
// bouncing back to "/" (DASH-5).
export function cardRoute(key: CardKey, role: Role | undefined): CardRoute | null {
  const target = CARD_TARGETS[key]
  return roleCanAccess(role, target.section) ? target.to : null
}

// Count for one status.
export function statusCount(
  list: DashboardStatusCount[] | undefined,
  status: string,
): number | undefined {
  return list?.find((s) => s.status === status)?.count
}

// Rupiah chart axis ceiling.
export function computeRpMax(values: number[]): number {
  const m = Math.max(...values, 0)
  if (m <= 50_000_000) return 50_000_000
  const step = 10 ** Math.floor(Math.log10(m))
  return Math.ceil(m / step) * step
}

// Cost per bucket.
//
// Revenue and profit are both DPP-based, so revenue minus profit is the cost
// the Total Pengeluaran card sums. A bucket never goes below zero.
export function expenseSeries(revenue: number[], profit: number[]): number[] {
  return revenue.map((v, i) => Math.max(0, v - (profit[i] ?? 0)))
}

export type Badge = { bg: string; color: string }

// Unknown status badge, 9.7:1.
export const NEUTRAL_BADGE: Badge = { bg: "#F3F4F6", color: "#374151" }

export type RecentQuotation = {
  id: number
  quotationNo: string
  version: number
  client: string
  date: string
  total: string
  label: string
  badge: Badge
}

// Recent quotation table row.
//
// The label comes from the summary's status list when present, so the table
// and the tiles on one screen agree. A status the web does not know yet
// falls back to that label or the raw value and a neutral badge
// instead of crashing the row.
export function toRecentQuotation(
  q: QuotationListRow,
  labels: DashboardStatusCount[] = [],
): RecentQuotation {
  const known: QuotationStatusLabel | undefined = quotationStatusLabel(q.status)
  const apiLabel = labels.find((s) => s.status === q.status)?.label
  return {
    id: q.id,
    quotationNo: q.quotationNo,
    version: q.version,
    client: q.companyName,
    date: formatDate(q.createdAt),
    total: `Rp${formatNumber(q.grandTotal)}`,
    label: apiLabel ?? known ?? q.status,
    badge: (known && quotationBadge[known]) || NEUTRAL_BADGE,
  }
}

export type RecentInvoice = {
  id: number
  quotationId: number
  clientId: number
  invoiceNo: string
  client: string
  invoiceDate: string
  dueDate: string
  total: string
  status: InvoiceStatus
}

// Recent invoice rows, five max.
//
// The server already leaves cancelled invoices out; dropping them here too
// keeps the table honest if the filter is ever lost.
export function toRecentInvoices(rows: InvoiceBackendRow[]): RecentInvoice[] {
  const out: RecentInvoice[] = []
  for (const inv of rows) {
    const status = deriveInvoiceStatus(inv, { cancelledAsNull: true })
    if (!status) continue
    out.push({
      id: inv.id,
      quotationId: inv.quotationId,
      clientId: inv.companyClientId,
      invoiceNo: inv.invoiceNo,
      client: inv.companyName,
      invoiceDate: inv.invoiceDate,
      dueDate: inv.dueDate ?? inv.invoiceDate,
      total: formatRupiah(toNum(inv.total ?? inv.subtotal)),
      status,
    })
    if (out.length === 5) break
  }
  return out
}
