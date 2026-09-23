import { describe, expect, it } from "vitest"
import { quotationBadge } from "@/lib/status"
import type { DashboardStatusCount, InvoiceBackendRow, QuotationListRow, Role } from "@/types/api"
import {
  type CardKey,
  cardRoute,
  computeRpMax,
  expenseSeries,
  NEUTRAL_BADGE,
  statusCount,
  toRecentInvoices,
  toRecentQuotation,
} from "./helpers"

// Card gating per role
describe("cardRoute", () => {
  const cases: { role: Role | undefined; key: CardKey; want: string | null }[] = [
    { role: "superadmin", key: "invoices", want: "/invoices" },
    { role: "superadmin", key: "quotations", want: "/quotations" },
    { role: "superadmin", key: "purchaseOrders", want: "/purchase-orders" },
    { role: "finance", key: "invoices", want: "/invoices" },
    { role: "finance", key: "quotations", want: null },
    { role: "finance", key: "purchaseOrders", want: null },
    { role: "operational", key: "invoices", want: null },
    { role: "operational", key: "quotations", want: "/quotations" },
    { role: "operational", key: "purchaseOrders", want: "/purchase-orders" },
    { role: undefined, key: "quotations", want: null },
  ]
  for (const c of cases) {
    it(`${c.role ?? "no role"} ${c.key}`, () => {
      expect(cardRoute(c.key, c.role)).toBe(c.want)
    })
  }
})

// Status list lookup
describe("statusCount", () => {
  const list: DashboardStatusCount[] = [
    { status: "rejected", label: "Ditolak", count: 3 },
    { status: "cancelled", label: "Dibatalkan", count: 0 },
  ]
  const cases = [
    { name: "present", list, status: "rejected", want: 3 },
    { name: "zero stays zero", list, status: "cancelled", want: 0 },
    { name: "absent", list, status: "expired", want: undefined },
    { name: "no list", list: undefined, status: "rejected", want: undefined },
  ]
  for (const c of cases) {
    it(c.name, () => {
      expect(statusCount(c.list, c.status)).toBe(c.want)
    })
  }
})

// Rupiah axis ceiling
describe("computeRpMax", () => {
  const cases = [
    { name: "empty floors at 50 Jt", values: [], want: 50_000_000 },
    { name: "small floors at 50 Jt", values: [1_000, 49_000_000], want: 50_000_000 },
    { name: "rounds up to the leading digit", values: [123_000_000], want: 200_000_000 },
    { name: "exact step stays", values: [300_000_000], want: 300_000_000 },
    { name: "negatives ignored", values: [-5, 60_000_000], want: 60_000_000 },
  ]
  for (const c of cases) {
    it(c.name, () => {
      expect(computeRpMax(c.values)).toBe(c.want)
    })
  }
})

// Expense derivation
describe("expenseSeries", () => {
  const cases = [
    { name: "revenue minus profit", revenue: [100, 50], profit: [30, 50], want: [70, 0] },
    { name: "never negative", revenue: [10], profit: [25], want: [0] },
    { name: "missing profit counts as zero", revenue: [10, 20], profit: [5], want: [5, 20] },
  ]
  for (const c of cases) {
    it(c.name, () => {
      expect(expenseSeries(c.revenue, c.profit)).toEqual(c.want)
    })
  }
})

// Rows as the API sends them; JSON keeps statuses the web types lack.
function quotation(status: string): QuotationListRow {
  return JSON.parse(
    JSON.stringify({
      id: 7,
      quotationNo: "Q-0007",
      version: 2,
      companyName: "PT Laut",
      status,
      grandTotal: "1500000",
      subtotal: "1500000",
      totalDiscount: "0",
      totalHargaBeli: "900000",
      createdAt: "2026-09-01T03:00:00Z",
    }),
  )
}

// Recent quotation mapping
describe("toRecentQuotation", () => {
  const labels: DashboardStatusCount[] = [
    { status: "rejected", label: "Ditolak", count: 1 },
    { status: "expired", label: "Kedaluwarsa", count: 1 },
    { status: "cancelled", label: "Dibatalkan", count: 1 },
    { status: "archived", label: "Diarsipkan", count: 1 },
  ]

  it("maps the display fields", () => {
    const row = toRecentQuotation(quotation("sent"))
    expect(row).toMatchObject({
      id: 7,
      quotationNo: "Q-0007",
      version: 2,
      client: "PT Laut",
      total: "Rp1.500.000",
      label: "Dikirim",
      badge: quotationBadge.Dikirim,
    })
  })

  const cases = [
    { name: "known status keeps its label", status: "rejected", want: "Ditolak" },
    { name: "API label wins over the local one", status: "expired", want: "Kedaluwarsa" },
    { name: "cancelled reads Dibatalkan", status: "cancelled", want: "Dibatalkan" },
    { name: "unknown status uses the API label", status: "archived", want: "Diarsipkan" },
  ]
  for (const c of cases) {
    it(c.name, () => {
      expect(toRecentQuotation(quotation(c.status), labels).label).toBe(c.want)
    })
  }

  it("known status badge is its own", () => {
    expect(toRecentQuotation(quotation("rejected"), labels).badge).toEqual(quotationBadge.Ditolak)
  })

  it("unknown status gets a neutral badge, not a crash", () => {
    expect(toRecentQuotation(quotation("archived"), labels).badge).toEqual(NEUTRAL_BADGE)
  })

  it("unknown status without labels shows the raw value", () => {
    expect(toRecentQuotation(quotation("archived")).label).toBe("archived")
  })
})

function invoice(id: number, over: Partial<InvoiceBackendRow> = {}): InvoiceBackendRow {
  return {
    id,
    invoiceNo: `INV-${id}`,
    quotationId: 100 + id,
    quotationNo: `Q-${id}`,
    companyClientId: 9,
    companyName: "PT Laut",
    invoiceDate: "2026-09-01",
    dueDate: "2099-01-01",
    total: "2000000",
    status: "sent",
    rowVersion: 1,
    createdAt: "2026-09-01T03:00:00Z",
    updatedAt: "2026-09-01T03:00:00Z",
    ...over,
  }
}

// Recent invoice mapping
describe("toRecentInvoices", () => {
  it("keys links by quotation and client id", () => {
    const [row] = toRecentInvoices([invoice(1)])
    expect(row).toMatchObject({
      id: 1,
      quotationId: 101,
      clientId: 9,
      invoiceNo: "INV-1",
      total: "Rp2.000.000",
      status: "DIKIRIM",
    })
  })

  it("drops cancelled and caps at five", () => {
    const rows = [
      invoice(1, { status: "cancelled" }),
      ...[2, 3, 4, 5, 6, 7].map((id) => invoice(id)),
    ]
    expect(toRecentInvoices(rows).map((r) => r.id)).toEqual([2, 3, 4, 5, 6])
  })

  const cases = [
    { name: "paid", over: { status: "paid" as const }, want: "DIBAYAR" },
    { name: "past due sent", over: { dueDate: "2000-01-01" }, want: "TERLAMBAT" },
    { name: "draft", over: { status: "draft" as const }, want: "DRAF" },
  ]
  for (const c of cases) {
    it(c.name, () => {
      const [row] = toRecentInvoices([invoice(1, c.over)])
      expect(row?.status).toBe(c.want)
    })
  }

  it("uses the invoice date when there is no due date", () => {
    const [row] = toRecentInvoices([invoice(1, { dueDate: undefined, invoiceDate: "2099-02-02" })])
    expect(row?.dueDate).toBe("2099-02-02")
  })

  it("totals from the subtotal when total is missing", () => {
    const [row] = toRecentInvoices([invoice(1, { total: undefined, subtotal: "5000" })])
    expect(row?.total).toBe("Rp5.000")
  })
})
