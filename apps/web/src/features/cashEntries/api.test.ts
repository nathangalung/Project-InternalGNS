import { beforeEach, describe, expect, it, vi } from "vitest"
import { apiList, apiRequest, downloadXlsx } from "@/lib/api-client"
import type { CashEntryInput } from "@/types/api"
import * as api from "./api"

vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  apiRequest: vi.fn(async () => undefined),
  apiList: vi.fn(async () => ({ rows: [], total: 0 })),
  downloadXlsx: vi.fn(async () => {}),
}))

const input: CashEntryInput = {
  entryDate: "2026-09-15",
  direction: "out",
  category: "Sewa",
  amount: "100",
  description: "Sewa",
}

const filter: api.CashEntryParams = {
  q: "bank",
  direction: "in",
  category: "Modal",
  dateFrom: "2026-09-01",
  dateTo: "2026-09-30",
  limit: 10,
  offset: 20,
}

describe("cash entries api", () => {
  beforeEach(() => vi.clearAllMocks())

  it("lists with and without a filter", async () => {
    await api.list()
    expect(apiList).toHaveBeenLastCalledWith({ path: "/cash-entries" })
    await api.list(filter)
    expect(apiList).toHaveBeenLastCalledWith({
      path: "/cash-entries?q=bank&direction=in&category=Modal&dateFrom=2026-09-01&dateTo=2026-09-30&limit=10&offset=20",
    })
  })

  it("totals and exports without the page", async () => {
    await api.summary(filter)
    expect(apiRequest).toHaveBeenLastCalledWith({
      path: "/cash-entries/summary?q=bank&direction=in&category=Modal&dateFrom=2026-09-01&dateTo=2026-09-30",
    })
    await api.summary()
    expect(apiRequest).toHaveBeenLastCalledWith({ path: "/cash-entries/summary" })
    await api.exportXlsx(filter)
    expect(downloadXlsx).toHaveBeenLastCalledWith(
      "/cash-entries/export.xlsx?q=bank&direction=in&category=Modal&dateFrom=2026-09-01&dateTo=2026-09-30",
      "kas-lain.xlsx",
    )
    await api.exportXlsx()
    expect(downloadXlsx).toHaveBeenLastCalledWith("/cash-entries/export.xlsx", "kas-lain.xlsx")
  })

  it.each<[string, () => Promise<unknown>, Parameters<typeof apiRequest>[0]]>([
    ["categories", () => api.categories(), { path: "/cash-entries/categories" }],
    ["create", () => api.create(input), { path: "/cash-entries", method: "POST", body: input }],
    [
      "update",
      () => api.update(3, input, 2),
      { path: "/cash-entries/3", method: "PUT", body: input, headers: { "If-Match": "2" } },
    ],
    ["remove", () => api.remove(3), { path: "/cash-entries/3", method: "DELETE" }],
  ])("%s", async (_name, call, req) => {
    await call()
    expect(apiRequest).toHaveBeenCalledWith(req)
  })
})
