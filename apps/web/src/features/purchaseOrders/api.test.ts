import { beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError, apiList, apiRequest, downloadXlsx } from "@/lib/api-client"
import * as api from "./api"

vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  apiRequest: vi.fn(async () => undefined),
  apiList: vi.fn(async () => ({ rows: [], total: 0 })),
  downloadPdf: vi.fn(async () => {}),
  downloadXlsx: vi.fn(async () => {}),
  getRefreshToken: vi.fn(() => null),
}))

const request = vi.mocked(apiRequest)

describe("purchase orders api", () => {
  beforeEach(() => vi.clearAllMocks())

  it.each<[string, api.ListParams | undefined, string]>([
    ["no params", undefined, "/purchase-orders"],
    [
      "filters",
      { status: "PENDING", sortBy: "poDate", limit: 10 },
      "/purchase-orders?status=PENDING&sortBy=poDate&limit=10",
    ],
  ])("lists with %s", async (_name, params, path) => {
    await api.list(params)
    expect(apiList).toHaveBeenCalledWith({ path })
  })

  it.each<[string, api.ListParams | undefined, string]>([
    ["everything", undefined, "/purchase-orders/export.xlsx"],
    ["the filtered list", { q: "PO-9" }, "/purchase-orders/export.xlsx?q=PO-9"],
  ])("exports %s as delivery notes", async (_name, params, path) => {
    await api.exportXlsx(params)
    expect(downloadXlsx).toHaveBeenCalledWith(path, "delivery-note-export.xlsx")
  })

  it("reads a quotation without a PO as null", async () => {
    request.mockRejectedValueOnce(new ApiError(404, null, "x"))
    await expect(api.getByQuotation(8)).resolves.toBeNull()
    expect(request).toHaveBeenCalledWith({ path: "/purchase-orders/by-quotation/8" })
  })

  it("still fails a forbidden lookup", async () => {
    request.mockRejectedValueOnce(new ApiError(403, null, "x"))
    await expect(api.getByQuotation(8)).rejects.toMatchObject({ status: 403 })
  })

  it.each<[string, () => Promise<unknown>, Parameters<typeof apiRequest>[0]]>([
    ["get", () => api.get(3), { path: "/purchase-orders/3" }],
    ["items", () => api.listItems(3), { path: "/purchase-orders/3/items" }],
    ["history", () => api.listHistory(3), { path: "/purchase-orders/3/history" }],
    [
      "status without a note",
      () => api.changeStatus(3, "ON_PROGRESS"),
      { path: "/purchase-orders/3/status", method: "PATCH", body: { status: "ON_PROGRESS" } },
    ],
    [
      "cancel with its note",
      () => api.changeStatus(3, "CANCELLED", "Batal klien"),
      {
        path: "/purchase-orders/3/status",
        method: "PATCH",
        body: { status: "CANCELLED", note: "Batal klien" },
      },
    ],
    ["remove file", () => api.removeFile(3), { path: "/purchase-orders/3/file", method: "DELETE" }],
    [
      "attach file",
      () => api.updateFile(3, { fileName: "po.pdf", fileSize: 10, objectKey: "k" }),
      {
        path: "/purchase-orders/3/file",
        method: "PATCH",
        body: { fileName: "po.pdf", fileSize: 10, objectKey: "k" },
      },
    ],
    [
      "presign upload",
      () => api.presignUpload(3, "po 1.pdf"),
      { path: "/purchase-orders/3/upload-url?fileName=po+1.pdf" },
    ],
    ["presign download", () => api.presignDownload(3), { path: "/purchase-orders/3/download-url" }],
    [
      "details guard the row version",
      () => api.updateDetails(3, { poNumber: "PO-1", poDate: "2026-09-24" }, 6),
      {
        path: "/purchase-orders/3/details",
        method: "PATCH",
        body: { poNumber: "PO-1", poDate: "2026-09-24" },
        headers: { "If-Match": "6" },
      },
    ],
    [
      "items guard the row version",
      () => api.updateItems(3, { items: [] } as never, 7),
      {
        path: "/purchase-orders/3/items",
        method: "PUT",
        body: { items: [] },
        headers: { "If-Match": "7" },
      },
    ],
  ])("%s", async (_name, call, want) => {
    await call()
    expect(request).toHaveBeenCalledWith(want)
  })
})
