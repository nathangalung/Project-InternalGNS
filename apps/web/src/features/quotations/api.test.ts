import { beforeEach, describe, expect, it, vi } from "vitest"
import { apiList, apiRequest, downloadPdf, downloadXlsx } from "@/lib/api-client"
import * as api from "./api"

vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  apiRequest: vi.fn(async () => undefined),
  apiList: vi.fn(async () => ({ rows: [], total: 0 })),
  downloadPdf: vi.fn(async () => {}),
  downloadXlsx: vi.fn(async () => {}),
  getRefreshToken: vi.fn(() => null),
}))

describe("quotations api", () => {
  beforeEach(() => vi.clearAllMocks())

  it.each<[string, Parameters<typeof api.list>[0], string]>([
    ["no params", undefined, "/quotations"],
    [
      "statuses go out as one status list",
      { q: "Q-1", statuses: ["draft", "sent"], dateFrom: "2026-09-01", limit: 10 },
      "/quotations?q=Q-1&dateFrom=2026-09-01&limit=10&status=draft%2Csent",
    ],
  ])("lists with %s", async (_name, params, path) => {
    await api.list(params)
    expect(apiList).toHaveBeenCalledWith({ path })
  })

  it.each<[string, Parameters<typeof api.exportXlsx>[0], string]>([
    ["everything", undefined, "/quotations/export.xlsx"],
    ["the filtered list", { statuses: ["accepted"] }, "/quotations/export.xlsx?status=accepted"],
  ])("exports %s", async (_name, params, path) => {
    await api.exportXlsx(params)
    expect(downloadXlsx).toHaveBeenCalledWith(path, "quotation-export.xlsx")
  })

  it("names the PDF after a filesystem-safe number", async () => {
    await api.downloadPdfFile(5, "001/GNS/Q/IX/2026")
    expect(downloadPdf).toHaveBeenCalledWith("/quotations/5/pdf", "001_GNS_Q_IX_2026.pdf")
  })

  it.each<[string, () => Promise<unknown>, Parameters<typeof apiRequest>[0]]>([
    ["stats", () => api.stats(), { path: "/quotations/stats" }],
    ["get", () => api.get(5), { path: "/quotations/5" }],
    [
      "create",
      () => api.create({ companyId: 1 } as never),
      { path: "/quotations", method: "POST", body: { companyId: 1 } },
    ],
    [
      "update guards the row version",
      () => api.update(5, { notes: "x" } as never, 4),
      { path: "/quotations/5", method: "PUT", body: { notes: "x" }, headers: { "If-Match": "4" } },
    ],
    [
      "change status",
      () => api.changeStatus(5, "rejected", "Harga"),
      {
        path: "/quotations/5/status",
        method: "PATCH",
        body: { status: "rejected", note: "Harga" },
      },
    ],
    [
      "send with a note",
      () => api.send(5, "Kirim"),
      { path: "/quotations/5/send", method: "POST", body: { note: "Kirim" } },
    ],
    [
      "send without a note",
      () => api.send(5),
      { path: "/quotations/5/send", method: "POST", body: undefined },
    ],
    [
      "revise with a note",
      () => api.revise(5, "Ubah qty"),
      { path: "/quotations/5/revise", method: "POST", body: { note: "Ubah qty" } },
    ],
    [
      "revise without a note",
      () => api.revise(5),
      { path: "/quotations/5/revise", method: "POST", body: {} },
    ],
    [
      "switch contact",
      () => api.updateQuotationContact(5, 9),
      { path: "/quotations/5/contact", method: "PATCH", body: { contactId: 9 } },
    ],
    ["revisions", () => api.listRevisions(5), { path: "/quotations/5/revisions" }],
    ["requests", () => api.listRequests(5), { path: "/quotations/5/requests" }],
    [
      "create request",
      () => api.createRequest(5, { rawName: "Baut" } as never),
      { path: "/quotations/5/requests", method: "POST", body: { rawName: "Baut" } },
    ],
    [
      "update request",
      () => api.updateRequest(5, 2, { rawName: "Mur" } as never),
      { path: "/quotations/5/requests/2", method: "PUT", body: { rawName: "Mur" } },
    ],
    [
      "delete request",
      () => api.deleteRequest(5, 2),
      { path: "/quotations/5/requests/2", method: "DELETE" },
    ],
  ])("%s", async (_name, call, want) => {
    await call()
    expect(apiRequest).toHaveBeenCalledWith(want)
  })
})
