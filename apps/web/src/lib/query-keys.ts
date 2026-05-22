// Query key factory.
export const queryKeys = {
  auth: {
    me: () => ["me"] as const,
  },
  clients: {
    all: ["clients"] as const,
    list: (params: { limit?: number; offset?: number } = {}) =>
      ["clients", "list", params] as const,
    summary: () => ["clients", "summary"] as const,
    detail: (id: number) => ["clients", "detail", id] as const,
    search: (q: string) => ["clients", "search", q] as const,
    contacts: (companyId: number) => ["clients", companyId, "contacts"] as const,
  },
  countries: {
    all: ["countries"] as const,
    list: () => ["countries", "list"] as const,
  },
  items: {
    all: ["items"] as const,
    list: (params: Record<string, unknown> = {}) => ["items", "list", params] as const,
    detail: (id: number) => ["items", "detail", id] as const,
    search: (q: string) => ["items", "search", q] as const,
    searchAdvanced: (q: string, minScore?: number, limit?: number, isActive?: boolean) =>
      ["items", "search-advanced", q, minScore ?? null, limit ?? null, isActive ?? null] as const,
    vendors: (id: number) => ["items", id, "vendors"] as const,
    priceHistory: (id: number, limit?: number) => ["items", id, "price-history", limit] as const,
  },
  vendors: {
    all: ["vendors"] as const,
    list: (params: { limit?: number; offset?: number } = {}) =>
      ["vendors", "list", params] as const,
    detail: (id: number) => ["vendors", "detail", id] as const,
    search: (q: string) => ["vendors", "search", q] as const,
    items: (id: number) => ["vendors", id, "items"] as const,
  },
  units: {
    all: ["units"] as const,
    list: () => ["units", "list"] as const,
  },
  quotations: {
    all: ["quotations"] as const,
    list: (params: Record<string, unknown> = {}) => ["quotations", "list", params] as const,
    detail: (id: number) => ["quotations", "detail", id] as const,
    stats: () => ["quotations", "stats"] as const,
    requests: (id: number) => ["quotations", id, "requests"] as const,
    revisions: (id: number) => ["quotations", id, "revisions"] as const,
  },
  users: {
    all: ["users"] as const,
    list: (params: Record<string, unknown> = {}) => ["users", "list", params] as const,
    detail: (id: number) => ["users", "detail", id] as const,
  },
  purchaseOrders: {
    all: ["purchase-orders"] as const,
    list: (params: Record<string, unknown> = {}) => ["purchase-orders", "list", params] as const,
    detail: (id: number) => ["purchase-orders", "detail", id] as const,
    items: (id: number) => ["purchase-orders", id, "items"] as const,
    byQuotation: (quotationId: number) => ["purchase-orders", "by-quotation", quotationId] as const,
    itemVendors: (itemId: number) => ["purchase-orders", "item-vendors", itemId] as const,
    vendorDetail: (vendorId: number) => ["purchase-orders", "vendor-detail", vendorId] as const,
  },
  invoices: {
    all: ["invoices"] as const,
    list: (params: Record<string, unknown> = {}) => ["invoices", "list", params] as const,
    detail: (id: number) => ["invoices", "detail", id] as const,
    items: (id: number) => ["invoices", id, "items"] as const,
    byQuotation: (quotationId: number) => ["invoices", "by-quotation", quotationId] as const,
    summary: () => ["invoices", "summary"] as const,
  },
  dashboard: {
    all: ["dashboard"] as const,
    summary: () => ["dashboard", "summary"] as const,
    timeseries: (metric: string, from?: string, to?: string) =>
      ["dashboard", "timeseries", metric, from ?? null, to ?? null] as const,
  },
} as const
