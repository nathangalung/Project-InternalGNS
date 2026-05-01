// Query key factory.
export const queryKeys = {
  clients: {
    all: ["clients"] as const,
    list: (params: { limit?: number; offset?: number } = {}) =>
      ["clients", "list", params] as const,
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
    list: (params: { limit?: number; offset?: number } = {}) => ["items", "list", params] as const,
    detail: (id: number) => ["items", "detail", id] as const,
    search: (q: string) => ["items", "search", q] as const,
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
  },
  users: {
    all: ["users"] as const,
    list: (params: { limit?: number; offset?: number } = {}) =>
      ["users", "list", params] as const,
    detail: (id: number) => ["users", "detail", id] as const,
  },
  dashboard: {
    all: ["dashboard"] as const,
    summary: () => ["dashboard", "summary"] as const,
    timeseries: (metric: string, from?: string, to?: string) =>
      ["dashboard", "timeseries", metric, from ?? null, to ?? null] as const,
  },
} as const
