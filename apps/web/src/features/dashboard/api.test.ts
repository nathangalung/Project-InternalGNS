import { beforeEach, describe, expect, it, vi } from "vitest"
import { apiRequest, downloadXlsx } from "@/lib/api-client"
import { exportXlsx, summary, timeseries } from "./api"

vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  apiRequest: vi.fn(async () => undefined),
  apiList: vi.fn(async () => ({ rows: [], total: 0 })),
  downloadPdf: vi.fn(async () => {}),
  downloadXlsx: vi.fn(async () => {}),
  getRefreshToken: vi.fn(() => null),
}))

describe("dashboard api", () => {
  beforeEach(() => vi.clearAllMocks())

  it("reads the summary", async () => {
    await summary()
    expect(apiRequest).toHaveBeenCalledWith({ path: "/dashboard/summary" })
  })

  it.each<[string, number | undefined, string, string]>([
    [
      "scopes the export to a year",
      2026,
      "/dashboard/export.xlsx?year=2026",
      "dashboard-export-2026.xlsx",
    ],
    [
      "exports every year without one",
      undefined,
      "/dashboard/export.xlsx",
      "dashboard-export.xlsx",
    ],
  ])("%s", async (_name, year, path, name) => {
    await exportXlsx(year)
    expect(downloadXlsx).toHaveBeenCalledWith(path, name)
  })

  it.each<[string, Parameters<typeof timeseries>, string]>([
    ["metric only", ["revenue"], "/dashboard/timeseries?metric=revenue"],
    [
      "full daily window",
      ["profit", "2026-09-01", "2026-10-01", "day"],
      "/dashboard/timeseries?metric=profit&from=2026-09-01&to=2026-10-01&interval=day",
    ],
  ])("timeseries %s", async (_name, args, path) => {
    await timeseries(...args)
    expect(apiRequest).toHaveBeenCalledWith({ path })
  })
})
