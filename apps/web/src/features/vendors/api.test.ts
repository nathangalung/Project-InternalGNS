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

describe("vendors api", () => {
  beforeEach(() => vi.clearAllMocks())

  it.each<[string, () => Promise<unknown>, string]>([
    ["list without params", () => api.list(), "/vendors"],
    [
      "list with every filter",
      () =>
        api.list({
          q: "baja",
          isActive: false,
          countryName: "Indonesia",
          minTotal: "5",
          sortBy: "productCount",
          sortDir: "asc",
          limit: 5,
          offset: 10,
        }),
      "/vendors?q=baja&isActive=false&countryName=Indonesia&minTotal=5&sortBy=productCount&sortDir=asc&limit=5&offset=10",
    ],
    [
      "one page of items",
      () => api.listItems(4, { limit: 10, offset: 30 }),
      "/vendors/4/items?limit=10&offset=30",
    ],
  ])("%s", async (_name, call, path) => {
    await call()
    expect(apiList).toHaveBeenCalledWith({ path })
  })

  it.each<[string, () => Promise<unknown>, Parameters<typeof apiRequest>[0]]>([
    ["get", () => api.get(4), { path: "/vendors/4" }],
    [
      "create",
      () => api.create({ name: "CV B", contactInfo: { email: "b@x.id" } }),
      {
        path: "/vendors",
        method: "POST",
        body: { name: "CV B", contactInfo: { email: "b@x.id" } },
      },
    ],
    [
      "update",
      () => api.update(4, { name: "CV B", isActive: true, contactInfo: {} }),
      {
        path: "/vendors/4",
        method: "PUT",
        body: { name: "CV B", isActive: true, contactInfo: {} },
      },
    ],
    [
      "presign logo upload",
      () => api.presignLogoUpload(4, "l.png"),
      { path: "/vendors/4/logo/upload-url?fileName=l.png" },
    ],
    [
      "presign logo download",
      () => api.presignLogoDownload(4),
      { path: "/vendors/4/logo/download-url" },
    ],
    [
      "save logo key",
      () => api.updateLogo(4, "k"),
      { path: "/vendors/4/logo", method: "PATCH", body: { objectKey: "k" } },
    ],
  ])("%s", async (_name, call, want) => {
    await call()
    expect(apiRequest).toHaveBeenCalledWith(want)
  })
})
