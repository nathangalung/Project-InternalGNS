import { act } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "@/lib/api-client"
import { queryKeys } from "@/lib/query-keys"
import { toast } from "@/lib/toast"
import { problem } from "@/test/problem"
import { invalidated, renderQueryHook, seed, settle, until } from "@/test/query"
import * as api from "./api"
import {
  downloadQuotationPdf,
  exportQuotationsXlsx,
  LOCK_HEARTBEAT_MS,
  useChangeQuotationStatus,
  useCreateQuotation,
  useDeleteQuotationRequest,
  useEditLocks,
  useLiveChange,
  useQuotation,
  useQuotationLive,
  useQuotationRequests,
  useQuotationRevisions,
  useQuotationStats,
  useQuotations,
  useReviseQuotation,
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
// Product, client and vendor pages list the newest quotations.
const itemQuotations = queryKeys.items.quotations(9)
const deps = [qDetail, qList, dash, client, vendor, itemQuotations]

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

// Clients and vendors show counts.
describe("quotation writes", () => {
  it("create refreshes quotations, dashboard, clients and vendors", async () => {
    m.create.mockResolvedValue({ id: 5 })
    const { qc, result } = renderQueryHook(() => useCreateQuotation())
    seed(qc, [...deps, poList])
    await settle(() => result.current.mutateAsync({} as never))
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
  ])("%s toasts Indonesian copy on failure", async (_name, hook, fail, vars, msg) => {
    fail()
    const { result } = renderQueryHook(hook)
    await settle(() => result.current.mutateAsync(vars as never))
    expect(toast.error).toHaveBeenCalledWith(msg)
  })

  // The review card shows it inline.
  it.each<[string, () => { mutateAsync: (v: never) => Promise<unknown> }, () => void, unknown]>([
    [
      "request save",
      useUpsertQuotationRequest,
      () => m.createRequest.mockRejectedValue(new Error("")),
      { quotationId: 5, input: {} },
    ],
    [
      "request delete",
      useDeleteQuotationRequest,
      () => m.deleteRequest.mockRejectedValue(new Error("")),
      { quotationId: 5, requestId: 2 },
    ],
  ])("%s leaves a failure to the card, without a toast", async (_name, hook, fail, vars) => {
    fail()
    const { result } = renderQueryHook(hook)
    await settle(() => result.current.mutateAsync(vars as never))
    expect(toast.error).not.toHaveBeenCalled()
  })

  // The recent lists print the contact.
  it("contact change refreshes the quotation caches", async () => {
    m.updateQuotationContact.mockResolvedValue(undefined)
    const { qc, result } = renderQueryHook(() => useUpdateQuotationContact())
    seed(qc, [...deps, poList])
    await settle(() => result.current.mutateAsync({ id: 5, contactId: 2 }))
    expect(m.updateQuotationContact).toHaveBeenCalledWith(5, 2)
    expect(invalidated(qc, [...deps, poList])).toEqual(deps)
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

  // Q-8: accepting lists the PO.
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
      new ApiError(
        422,
        problem(422, { fields: { note: "Alasan wajib diisi." } }),
        "Alasan wajib diisi.",
      ),
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

describe("useQuotationLive", () => {
  // Stream body that ends after the given frames.
  const stream = (text: string) => new Response(text)

  it("reloads the quotation on every notice and stops on leave", async () => {
    let aborted: AbortSignal | undefined
    m.openEvents.mockImplementation((_id, signal) => {
      aborted = signal
      return Promise.resolve(stream("event: ready\ndata: {}\n\nevent: line\ndata: {}\n\n"))
    })
    const { qc, unmount } = renderQueryHook(() => useQuotationLive(5, [], 1))
    const spy = vi.spyOn(qc, "invalidateQueries")
    await until(() => expect(spy).toHaveBeenCalledTimes(2))
    expect(spy).toHaveBeenCalledWith({ queryKey: qDetail })
    expect(m.openEvents).toHaveBeenCalledWith(5, expect.any(AbortSignal))
    unmount()
    expect(aborted?.aborted).toBe(true)
  })

  it("follows nothing without an id", async () => {
    renderQueryHook(() => useQuotationLive(undefined, undefined, undefined))
    await act(async () => {})
    expect(m.openEvents).not.toHaveBeenCalled()
  })

  it("reloads when another user's claim lapses", async () => {
    vi.useFakeTimers()
    m.openEvents.mockReturnValue(new Promise<Response>(() => {}))
    const at = new Date(Date.now() + 5000).toISOString()
    const { qc, unmount } = renderQueryHook(() =>
      useQuotationLive(5, [{ part: "line:1", userId: 2, userName: "Budi", expiresAt: at }], 1),
    )
    const spy = vi.spyOn(qc, "invalidateQueries")
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5999)
    })
    expect(spy).not.toHaveBeenCalled()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2)
    })
    expect(spy).toHaveBeenCalledWith({ queryKey: qDetail })
    unmount()
    vi.useRealTimers()
  })
})

describe("useEditLocks", () => {
  it("claims, renews and releases parts", async () => {
    vi.useFakeTimers()
    m.lockPart.mockResolvedValue({ part: "line:1", expiresAt: "" })
    m.unlockPart.mockResolvedValue(undefined)
    const { result, unmount } = renderQueryHook(() => useEditLocks(5))
    let ok = false
    await act(async () => {
      ok = await result.current.acquire("line:1")
    })
    expect(ok).toBe(true)
    expect(result.current.holds("line:1")).toBe(true)
    await act(async () => {
      await result.current.acquire("header")
    })

    // A renewal the server refuses drops the part.
    m.lockPart.mockImplementation((_id, part) =>
      part === "header"
        ? Promise.reject(new Error("habis"))
        : Promise.resolve({ part, expiresAt: "" }),
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LOCK_HEARTBEAT_MS)
    })
    expect(m.lockPart).toHaveBeenCalledTimes(4)
    expect(result.current.holds("header")).toBe(false)

    await act(async () => {
      await result.current.release("line:1")
    })
    expect(m.unlockPart).toHaveBeenCalledWith(5, "line:1")
    expect(result.current.holds("line:1")).toBe(false)
    // Releasing a part not held sends nothing.
    await act(async () => {
      await result.current.release("line:1")
    })
    expect(m.unlockPart).toHaveBeenCalledTimes(1)

    await act(async () => {
      await result.current.acquire("line:2")
    })
    unmount()
    expect(m.unlockPart).toHaveBeenLastCalledWith(5, "line:2", false)
    vi.useRealTimers()
  })

  it("frees a claim granted after the page has left", async () => {
    let grant: (v: { part: string; expiresAt: string }) => void = () => undefined
    m.lockPart.mockReturnValue(new Promise((resolve) => (grant = resolve)))
    m.unlockPart.mockResolvedValue(undefined)
    const { result, unmount } = renderQueryHook(() => useEditLocks(5))
    const pending = result.current.acquire("header")
    unmount()
    let ok = true
    await act(async () => {
      grant({ part: "header", expiresAt: "" })
      ok = await pending
    })
    expect(ok).toBe(false)
    expect(m.unlockPart).toHaveBeenCalledWith(5, "header")
  })

  it("frees every part when the page goes away", async () => {
    m.lockPart.mockResolvedValue({ part: "header", expiresAt: "" })
    m.unlockPart.mockResolvedValue(undefined)
    const { result, unmount } = renderQueryHook(() => useEditLocks(5))
    await act(async () => {
      await result.current.acquire("header")
    })
    act(() => {
      window.dispatchEvent(new Event("pagehide"))
    })
    expect(m.unlockPart).toHaveBeenCalledWith(5, "header", true)
    expect(result.current.holds("header")).toBe(false)
    unmount()
    expect(m.unlockPart).toHaveBeenCalledTimes(1)
  })

  it("toasts the refusal unless quiet", async () => {
    m.lockPart.mockRejectedValue(
      new ApiError(409, problem(409, { code: "edit_locked" }), "Sedang diubah oleh Budi."),
    )
    const { result } = renderQueryHook(() => useEditLocks(5))
    let ok = true
    await act(async () => {
      ok = await result.current.acquire("line:1")
    })
    expect(ok).toBe(false)
    expect(toast.error).toHaveBeenCalledWith("Sedang diubah oleh Budi.")
    vi.mocked(toast.error).mockClear()
    await act(async () => {
      await result.current.acquire("header", { quiet: true })
    })
    expect(toast.error).not.toHaveBeenCalled()
  })

  it("claims nothing without an id", async () => {
    const { result } = renderQueryHook(() => useEditLocks(undefined))
    let ok = true
    await act(async () => {
      ok = await result.current.acquire("line:1")
      await result.current.release("line:1")
    })
    expect(ok).toBe(false)
    expect(m.lockPart).not.toHaveBeenCalled()
    expect(m.unlockPart).not.toHaveBeenCalled()
  })
})

describe("useLiveChange", () => {
  // Totals, counts and vendor links.
  //
  // A line save moves the list total and product count, and a line naming a
  // new vendor links it to the product. The client page stays put.
  it("runs the change and reloads what a line save moves", async () => {
    const { qc, result } = renderQueryHook(() => useLiveChange(5))
    const itemVendors = queryKeys.items.vendors(9)
    const vendorItems = queryKeys.vendors.items(1)
    const keys = [qDetail, qList, dash, itemVendors, vendorItems, client]
    seed(qc, keys)
    const change = vi.fn(async () => undefined)
    await settle(() => result.current.mutateAsync(change))
    expect(change).toHaveBeenCalled()
    expect(invalidated(qc, keys)).toEqual([qDetail, qList, dash, itemVendors, vendorItems])
  })

  it("toasts a refusal and still reloads", async () => {
    const { qc, result } = renderQueryHook(() => useLiveChange(5))
    seed(qc, [qDetail])
    await settle(() =>
      result.current.mutateAsync(() => Promise.reject(new Error("Sedang diubah oleh Budi."))),
    )
    expect(toast.error).toHaveBeenCalledWith("Sedang diubah oleh Budi.")
    expect(invalidated(qc, [qDetail])).toEqual([qDetail])
  })

  it("reloads nothing without an id", async () => {
    const { qc, result } = renderQueryHook(() => useLiveChange(undefined))
    seed(qc, [qDetail])
    await settle(() => result.current.mutateAsync(async () => undefined))
    expect(invalidated(qc, [qDetail])).toEqual([])
  })
})
