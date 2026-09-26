import { beforeEach, describe, expect, it, vi } from "vitest"
import { apiList, apiRequest } from "@/lib/api-client"
import * as api from "./api"

vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  apiRequest: vi.fn(async () => undefined),
  apiList: vi.fn(async () => ({ rows: [], total: 0 })),
  downloadPdf: vi.fn(async () => {}),
  downloadXlsx: vi.fn(async () => {}),
  getRefreshToken: vi.fn(() => null),
}))

describe("items api", () => {
  beforeEach(() => vi.clearAllMocks())

  it.each<[string, api.ItemListParams | undefined, string]>([
    ["no params", undefined, "/items"],
    [
      "every filter",
      {
        q: "baut",
        isActive: true,
        unitId: 3,
        sortBy: "impaCode",
        sortDir: "asc",
        limit: 10,
        offset: 0,
      },
      "/items?q=baut&isActive=true&unitId=3&sortBy=impaCode&sortDir=asc&limit=10&offset=0",
    ],
  ])("lists with %s", async (_name, params, path) => {
    await api.list(params)
    expect(apiList).toHaveBeenCalledWith({ path })
  })

  it.each<[string, () => Promise<unknown>, Parameters<typeof apiRequest>[0]]>([
    ["get", () => api.get(9), { path: "/items/9" }],
    [
      "update",
      () => api.update(9, { name: "Baut", isActive: true }),
      { path: "/items/9", method: "PUT", body: { name: "Baut", isActive: true } },
    ],
    [
      "advanced search pages with an offset",
      () => api.searchAdvanced("baut", { minScore: 0.2, limit: 10, offset: 20, isActive: true }),
      { path: "/items/search-advanced?q=baut&minScore=0.2&limit=10&offset=20&isActive=true" },
    ],
    [
      "advanced search bare",
      () => api.searchAdvanced("baut"),
      { path: "/items/search-advanced?q=baut" },
    ],
    [
      "match rows",
      () =>
        api.matchRows([{ impaCode: "1", name: "Baut", qty: 2, unit: "PCS" }], { autoCreate: true }),
      {
        path: "/items/match-rows",
        method: "POST",
        body: {
          rows: [{ impaCode: "1", name: "Baut", qty: 2, unit: "PCS" }],
          minScore: undefined,
          autoCreate: true,
        },
      },
    ],
    ["list vendors", () => api.listVendors(9), { path: "/items/9/vendors" }],
    [
      "add vendor",
      () => api.addVendor(9, { vendorId: 4, costPrice: "1000" }),
      { path: "/items/9/vendors", method: "POST", body: { vendorId: 4, costPrice: "1000" } },
    ],
    [
      "price history with a limit",
      () => api.priceHistory(9, { limit: 5 }),
      { path: "/items/9/price-history?limit=5" },
    ],
    ["price history bare", () => api.priceHistory(9), { path: "/items/9/price-history" }],
    [
      "create",
      () => api.create({ name: "Mur" }),
      { path: "/items", method: "POST", body: { name: "Mur" } },
    ],
    [
      "presign image upload",
      () => api.presignImageUpload(9, "a.png"),
      { path: "/items/9/image/upload-url?fileName=a.png" },
    ],
    [
      "presign image download",
      () => api.presignImageDownload(9),
      { path: "/items/9/image/download-url" },
    ],
    [
      "save image key",
      () => api.updateImage(9, "k"),
      { path: "/items/9/image", method: "PATCH", body: { objectKey: "k" } },
    ],
  ])("%s", async (_name, call, want) => {
    await call()
    expect(apiRequest).toHaveBeenCalledWith(want)
  })
})
