import { describe, expect, it } from "vitest"
import { queryKeys } from "./query-keys"

// Prefix match, as TanStack invalidates.
function startsWith(key: readonly unknown[], prefix: readonly unknown[]): boolean {
  return prefix.every((part, i) => JSON.stringify(part) === JSON.stringify(key[i]))
}

describe("queryKeys", () => {
  it("puts every key of a resource under its all prefix", () => {
    const cases: [readonly unknown[], readonly unknown[]][] = [
      [queryKeys.clients.all, queryKeys.clients.list({ limit: 10 })],
      [queryKeys.clients.all, queryKeys.clients.summary()],
      [queryKeys.clients.all, queryKeys.clients.detail(1)],
      [queryKeys.clients.all, queryKeys.clients.search("a")],
      [queryKeys.clients.all, queryKeys.clients.contacts(1)],
      [queryKeys.countries.all, queryKeys.countries.list()],
      [queryKeys.units.all, queryKeys.units.list()],
      [queryKeys.items.all, queryKeys.items.list()],
      [queryKeys.items.all, queryKeys.items.detail(1)],
      [queryKeys.items.all, queryKeys.items.search("a")],
      [queryKeys.items.all, queryKeys.items.searchAdvanced("a")],
      [queryKeys.items.all, queryKeys.items.vendors(1)],
      [queryKeys.items.all, queryKeys.items.priceHistory(1, 5)],
      [queryKeys.vendors.all, queryKeys.vendors.list()],
      [queryKeys.vendors.all, queryKeys.vendors.detail(1)],
      [queryKeys.vendors.all, queryKeys.vendors.search("a")],
      [queryKeys.vendors.all, queryKeys.vendors.items(1)],
      [queryKeys.quotations.all, queryKeys.quotations.list()],
      [queryKeys.quotations.all, queryKeys.quotations.detail(1)],
      [queryKeys.quotations.all, queryKeys.quotations.stats()],
      [queryKeys.quotations.all, queryKeys.quotations.requests(1)],
      [queryKeys.quotations.all, queryKeys.quotations.revisions(1)],
      [queryKeys.users.all, queryKeys.users.list()],
      [queryKeys.users.all, queryKeys.users.detail(1)],
      [queryKeys.purchaseOrders.all, queryKeys.purchaseOrders.list()],
      [queryKeys.purchaseOrders.all, queryKeys.purchaseOrders.detail(1)],
      [queryKeys.purchaseOrders.all, queryKeys.purchaseOrders.items(1)],
      [queryKeys.purchaseOrders.all, queryKeys.purchaseOrders.byQuotation(1)],
      [queryKeys.invoices.all, queryKeys.invoices.list()],
      [queryKeys.invoices.all, queryKeys.invoices.detail(1)],
      [queryKeys.invoices.all, queryKeys.invoices.items(1)],
      [queryKeys.invoices.all, queryKeys.invoices.byQuotation(1)],
      [queryKeys.invoices.all, queryKeys.invoices.summary()],
      [queryKeys.dashboard.all, queryKeys.dashboard.summary()],
      [queryKeys.dashboard.all, queryKeys.dashboard.timeseries("revenue")],
    ]
    for (const [prefix, key] of cases) expect(startsWith(key, prefix)).toBe(true)
  })

  it("lets a client list refresh without touching the open detail form", () => {
    const lists = queryKeys.clients.lists()
    expect(startsWith(queryKeys.clients.list({ limit: 10, offset: 20 }), lists)).toBe(true)
    expect(startsWith(queryKeys.clients.list(), lists)).toBe(true)
    expect(startsWith(queryKeys.clients.detail(7), lists)).toBe(false)
    expect(startsWith(queryKeys.clients.contacts(7), lists)).toBe(false)
  })

  it("keeps the /auth/me key apart from the users cache", () => {
    expect(queryKeys.auth.me()).toEqual(["me"])
    expect(startsWith(queryKeys.auth.me(), queryKeys.users.all)).toBe(false)
  })

  it("separates params that change the result", () => {
    expect(queryKeys.items.searchAdvanced("bolt", 0.3, 10, true)).not.toEqual(
      queryKeys.items.searchAdvanced("bolt", 0.3, 10, false),
    )
    expect(queryKeys.items.searchAdvanced("bolt")).toEqual([
      "items",
      "search-advanced",
      "bolt",
      null,
      null,
      null,
    ])
    expect(queryKeys.dashboard.timeseries("revenue", "2026-01-01", "2027-01-01", "month")).toEqual([
      "dashboard",
      "timeseries",
      "revenue",
      "2026-01-01",
      "2027-01-01",
      "month",
    ])
    expect(queryKeys.dashboard.timeseries("profit")).toEqual([
      "dashboard",
      "timeseries",
      "profit",
      null,
      null,
      null,
    ])
  })
})
