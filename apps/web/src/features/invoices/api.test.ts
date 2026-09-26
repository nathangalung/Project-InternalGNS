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

describe("invoices api", () => {
  beforeEach(() => vi.clearAllMocks())

  it.each<[string, api.ListParams | undefined, string]>([
    ["no params", undefined, "/invoices"],
    [
      "effective status and due window",
      { effectiveStatus: "overdue,sent", dueFrom: "2026-09-01", dueTo: "2026-09-30" },
      "/invoices?effectiveStatus=overdue%2Csent&dueFrom=2026-09-01&dueTo=2026-09-30",
    ],
  ])("lists with %s", async (_name, params, path) => {
    await api.list(params)
    expect(apiList).toHaveBeenCalledWith({ path })
  })

  it.each<
    [string, (p?: api.ListParams) => Promise<void>, api.ListParams | undefined, string, string]
  >([
    ["list export", api.exportXlsx, undefined, "/invoices/export.xlsx", "invoice-export.xlsx"],
    [
      "filtered list export",
      api.exportXlsx,
      { status: "paid" },
      "/invoices/export.xlsx?status=paid",
      "invoice-export.xlsx",
    ],
    [
      "Coretax workbook",
      api.exportCoretaxXlsx,
      undefined,
      "/invoices/coretax.xlsx",
      "coretax-export.xlsx",
    ],
    [
      "filtered Coretax workbook",
      api.exportCoretaxXlsx,
      { dateFrom: "2026-09-01" },
      "/invoices/coretax.xlsx?dateFrom=2026-09-01",
      "coretax-export.xlsx",
    ],
  ])("%s", async (_name, fn, params, path, name) => {
    await fn(params)
    expect(downloadXlsx).toHaveBeenCalledWith(path, name)
  })

  it.each<[string, (id: number) => Promise<unknown>, string]>([
    ["by quotation", api.getByQuotation, "/invoices/by-quotation/4"],
    ["by id", api.getById, "/invoices/4"],
  ])("reads a missing invoice %s as null", async (_name, fn, path) => {
    request.mockRejectedValueOnce(new ApiError(404, null, "x"))
    await expect(fn(4)).resolves.toBeNull()
    expect(request).toHaveBeenCalledWith({ path })
  })

  it.each<[string, () => Promise<unknown>, Parameters<typeof apiRequest>[0]]>([
    ["summary", () => api.summary(), { path: "/invoices/summary" }],
    ["items", () => api.listItems(4), { path: "/invoices/4/items" }],
    [
      "status",
      () => api.changeStatus(4, { status: "paid", paymentProofKey: "k" }),
      {
        path: "/invoices/4/status",
        method: "PATCH",
        body: { status: "paid", paymentProofKey: "k" },
      },
    ],
    ["replacement", () => api.replace(4), { path: "/invoices/4/replacement", method: "POST" }],
    [
      "dates guard the row version",
      () => api.updateDates(4, { dueDate: "2026-10-01T00:00:00+07:00" }, 2),
      {
        path: "/invoices/4/dates",
        method: "PATCH",
        body: { dueDate: "2026-10-01T00:00:00+07:00" },
        headers: { "If-Match": "2" },
      },
    ],
    [
      "proof upload",
      () => api.presignPaymentProofUpload(4, "bukti.pdf"),
      { path: "/invoices/4/payment-proof/upload-url?fileName=bukti.pdf" },
    ],
    [
      "proof download",
      () => api.presignPaymentProofDownload(4),
      { path: "/invoices/4/payment-proof/download-url" },
    ],
    [
      "attachment upload",
      () => api.presignAttachmentUpload(4, "a b.pdf"),
      { path: "/invoices/4/attachment/upload-url?fileName=a+b.pdf" },
    ],
    [
      "attachment download",
      () => api.presignAttachmentDownload(4),
      { path: "/invoices/4/attachment/download-url" },
    ],
    [
      "attachment key",
      () => api.updateAttachment(4, "k"),
      { path: "/invoices/4/attachment", method: "PATCH", body: { objectKey: "k" } },
    ],
  ])("%s", async (_name, call, want) => {
    await call()
    expect(request).toHaveBeenCalledWith(want)
  })
})
