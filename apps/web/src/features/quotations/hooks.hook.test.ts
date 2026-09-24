import { beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "@/lib/api-client"
import { queryKeys } from "@/lib/query-keys"
import { toast } from "@/lib/toast"
import { invalidated, renderQueryHook, seed, settle, until } from "@/test/query"
import * as api from "./api"
import {
  downloadQuotationPdf,
  exportQuotationsXlsx,
  useChangeQuotationStatus,
  useCreateQuotation,
  useDeleteQuotationRequest,
  useQuotation,
  useQuotationRequests,
  useQuotationRevisions,
  useQuotationStats,
  useQuotations,
  useReviseQuotation,
  useUpdateQuotation,
  useUpdateQuotationContact,
  useUpsertQuotationRequest,
} from "./hooks"

vi.mock("./api")
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))

const m = vi.mocked(api)

const qDetail = queryKeys.quotations.detail(5)
const qList = queryKeys.quotations.list()
const dash = queryKeys.dashboard.summary()
const client = queryKeys.clients.detail(1)
const vendor = queryKeys.vendors.detail(1)
const poList = queryKeys.purchaseOrders.list()
const invoices = queryKeys.invoices.list()
const deps = [qDetail, qList, dash, client, vendor]

beforeEach(() => vi.clearAllMocks())

describe("quotation queries", () => {
  it("lists with the given params", async () => {
    m.list.mockResolvedValue({ rows: [], total: 0 })
    const { result } = renderQueryHook(() => useQuotations({ statuses: ["sent"] }))
    await until(() => expect(result.current.isSuccess).toBe(true))
    expect(m.list).toHaveBeenCalledWith({ statuses: ["sent"] })
  })

  it("reads the stats", async () => {
    m.stats.mockResolvedValue([])
    const { result } = renderQueryHook(() => useQuotationStats())
    await until(() => expect(result.current.data).toEqual([]))
  })

  it.each<[string, () => { fetchStatus: string }, () => unknown]>([
    ["quotation", () => useQuotation(undefined), () => m.get],
    ["revisions", () => useQuotationRevisions(0), () => m.listRevisions],
    ["requests", () => useQuotationRequests(undefined), () => m.listRequests],
  ])("does not fetch %s without an id", async (_name, hook, fn) => {
    const { result } = renderQueryHook(hook)
    await until(() => expect(result.current.fetchStatus).toBe("idle"))
    expect(fn()).not.toHaveBeenCalled()
  })

  it("fetches detail, revisions and requests for a real id", async () => {
    m.get.mockResolvedValue({ id: 5 } as never)
    m.listRevisions.mockResolvedValue([])
    m.listRequests.mockResolvedValue([])
    const d = renderQueryHook(() => useQuotation(5))
    const r = renderQueryHook(() => useQuotationRevisions(5))
    const q = renderQueryHook(() => useQuotationRequests(5))
    await until(() => {
      expect(d.result.current.isSuccess).toBe(true)
      expect(r.result.current.isSuccess).toBe(true)
      expect(q.result.current.isSuccess).toBe(true)
    })
    expect(m.get).toHaveBeenCalledWith(5)
    expect(m.listRevisions).toHaveBeenCalledWith(5)
    expect(m.listRequests).toHaveBeenCalledWith(5)
  })
})

// Client and vendor pages show quotation counts.
describe("quotation writes", () => {
  it("create refreshes quotations, dashboard, clients and vendors", async () => {
    m.create.mockResolvedValue({ id: 5 })
    const { qc, result } = renderQueryHook(() => useCreateQuotation())
    seed(qc, [...deps, poList])
    await settle(() => result.current.mutateAsync({} as never))
    expect(invalidated(qc, [...deps, poList])).toEqual(deps)
  })

  it("update sends the row version and refreshes the same caches", async () => {
    m.update.mockResolvedValue({ id: 5, rowVersion: 3 })
    const { qc, result } = renderQueryHook(() => useUpdateQuotation())
    seed(qc, [...deps, poList])
    await settle(() => result.current.mutateAsync({ id: 5, input: {} as never, rowVersion: 2 }))
    expect(m.update).toHaveBeenCalledWith(5, {}, 2)
    expect(invalidated(qc, [...deps, poList])).toEqual(deps)
  })

  it("revise refreshes the same caches", async () => {
    m.revise.mockResolvedValue({ id: 6 })
    const { qc, result } = renderQueryHook(() => useReviseQuotation())
    seed(qc, deps)
    await settle(() => result.current.mutateAsync({ id: 5, note: "Ubah qty" }))
    expect(m.revise).toHaveBeenCalledWith(5, "Ubah qty")
    expect(invalidated(qc, deps)).toEqual(deps)
  })

  it.each<
    [string, () => { mutateAsync: (v: never) => Promise<unknown> }, () => void, unknown, string]
  >([
    [
      "create",
      useCreateQuotation,
      () => m.create.mockRejectedValue(new Error("")),
      {},
      "Gagal menyimpan quotation.",
    ],
    [
      "update",
      useUpdateQuotation,
      () => m.update.mockRejectedValue(new Error("")),
      { id: 5, input: {}, rowVersion: 1 },
      "Gagal memperbarui quotation.",
    ],
    [
      "revise",
      useReviseQuotation,
      () => m.revise.mockRejectedValue(new Error("")),
      { id: 5 },
      "Gagal membuat revisi quotation.",
    ],
    [
      "contact",
      useUpdateQuotationContact,
      () => m.updateQuotationContact.mockRejectedValue(new Error("")),
      { id: 5, contactId: 2 },
      "Gagal mengubah narahubung quotation.",
    ],
    [
      "request save",
      useUpsertQuotationRequest,
      () => m.createRequest.mockRejectedValue(new Error("")),
      { quotationId: 5, input: {} },
      "Gagal menyimpan item request.",
    ],
    [
      "request delete",
      useDeleteQuotationRequest,
      () => m.deleteRequest.mockRejectedValue(new Error("")),
      { quotationId: 5, requestId: 2 },
      "Gagal menghapus item request.",
    ],
  ])("%s toasts Indonesian copy on failure", async (_name, hook, fail, vars, msg) => {
    fail()
    const { result } = renderQueryHook(hook)
    await settle(() => result.current.mutateAsync(vars as never))
    expect(toast.error).toHaveBeenCalledWith(msg)
  })

  it("contact change refreshes only that quotation", async () => {
    m.updateQuotationContact.mockResolvedValue(undefined)
    const { qc, result } = renderQueryHook(() => useUpdateQuotationContact())
    seed(qc, [qDetail, qList])
    await settle(() => result.current.mutateAsync({ id: 5, contactId: 2 }))
    expect(m.updateQuotationContact).toHaveBeenCalledWith(5, 2)
    expect(invalidated(qc, [qDetail, qList])).toEqual([qDetail])
  })
})

describe("useChangeQuotationStatus", () => {
  it("sends through the send endpoint, which numbers and dates the quotation", async () => {
    m.send.mockResolvedValue(undefined)
    const { result } = renderQueryHook(() => useChangeQuotationStatus())
    await settle(() => result.current.mutateAsync({ id: 5, status: "sent", note: "Kirim" }))
    expect(m.send).toHaveBeenCalledWith(5, "Kirim")
    expect(m.changeStatus).not.toHaveBeenCalled()
  })

  // Q-8: accepting creates a PO, which must show in the PO list.
  it("refreshes purchase orders as well after accepting", async () => {
    m.changeStatus.mockResolvedValue(undefined)
    const { qc, result } = renderQueryHook(() => useChangeQuotationStatus())
    seed(qc, [...deps, poList, invoices])
    await settle(() => result.current.mutateAsync({ id: 5, status: "accepted" }))
    expect(m.changeStatus).toHaveBeenCalledWith(5, "accepted", undefined)
    expect(invalidated(qc, [...deps, poList, invoices])).toEqual([...deps, poList])
  })

  it("stays quiet when the note is rejected, since the modal shows it", async () => {
    m.changeStatus.mockRejectedValue(
      new ApiError(422, { fields: { note: "Alasan wajib diisi." } }, "Alasan wajib diisi."),
    )
    const { result } = renderQueryHook(() => useChangeQuotationStatus())
    await settle(() => result.current.mutateAsync({ id: 5, status: "rejected" }))
    expect(toast.error).not.toHaveBeenCalled()
  })

  it("toasts any other failure", async () => {
    m.changeStatus.mockRejectedValue(new ApiError(409, null, "Status sudah berubah."))
    const { result } = renderQueryHook(() => useChangeQuotationStatus())
    await settle(() => result.current.mutateAsync({ id: 5, status: "cancelled" }))
    expect(toast.error).toHaveBeenCalledWith("Status sudah berubah.")
  })
})

describe("item requests", () => {
  const reqs = queryKeys.quotations.requests(5)
  const other = queryKeys.quotations.requests(6)

  it("creates a request without an id and refreshes that quotation's requests", async () => {
    m.createRequest.mockResolvedValue({ id: 2 } as never)
    const { qc, result } = renderQueryHook(() => useUpsertQuotationRequest())
    seed(qc, [reqs, other, qDetail])
    await settle(() =>
      result.current.mutateAsync({ quotationId: 5, input: { rawName: "Baut" } as never }),
    )
    expect(m.createRequest).toHaveBeenCalledWith(5, { rawName: "Baut" })
    expect(m.updateRequest).not.toHaveBeenCalled()
    expect(invalidated(qc, [reqs, other, qDetail])).toEqual([reqs])
  })

  it("updates a request with an id", async () => {
    m.updateRequest.mockResolvedValue({ id: 2 } as never)
    const { result } = renderQueryHook(() => useUpsertQuotationRequest())
    await settle(() =>
      result.current.mutateAsync({
        quotationId: 5,
        requestId: 2,
        input: { rawName: "Mur" } as never,
      }),
    )
    expect(m.updateRequest).toHaveBeenCalledWith(5, 2, { rawName: "Mur" })
    expect(m.createRequest).not.toHaveBeenCalled()
  })

  it("deletes a request and refreshes that quotation's requests", async () => {
    m.deleteRequest.mockResolvedValue(undefined)
    const { qc, result } = renderQueryHook(() => useDeleteQuotationRequest())
    seed(qc, [reqs, other])
    await settle(() => result.current.mutateAsync({ quotationId: 5, requestId: 2 }))
    expect(m.deleteRequest).toHaveBeenCalledWith(5, 2)
    expect(invalidated(qc, [reqs, other])).toEqual([reqs])
  })
})

describe("downloads", () => {
  it("downloads the PDF quietly on success", async () => {
    m.downloadPdfFile.mockResolvedValue(undefined)
    await downloadQuotationPdf(5, "Q/1")
    expect(m.downloadPdfFile).toHaveBeenCalledWith(5, "Q/1")
    expect(toast.error).not.toHaveBeenCalled()
  })

  it("toasts Indonesian copy when the PDF fails", async () => {
    m.downloadPdfFile.mockRejectedValue(new Error("Bad Gateway"))
    await downloadQuotationPdf(5, "Q/1")
    expect(toast.error).toHaveBeenCalledWith("Gagal mengunduh PDF quotation. Coba lagi.")
  })

  it("exports the filtered list", async () => {
    m.exportXlsx.mockResolvedValue(undefined)
    await exportQuotationsXlsx({ statuses: ["draft"] })
    expect(m.exportXlsx).toHaveBeenCalledWith({ statuses: ["draft"] })
    expect(toast.error).not.toHaveBeenCalled()
  })

  it("toasts Indonesian copy when the export fails", async () => {
    m.exportXlsx.mockRejectedValue(new Error("Forbidden"))
    await exportQuotationsXlsx({})
    expect(toast.error).toHaveBeenCalledWith("Gagal mengekspor daftar quotation. Coba lagi.")
  })
})
