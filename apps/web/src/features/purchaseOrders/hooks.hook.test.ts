import { act } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useMe } from "@/features/auth/hooks"
import * as invoicesApi from "@/features/invoices/api"
import * as usersApi from "@/features/users/api"
import { ApiError } from "@/lib/api-client"
import { queryKeys } from "@/lib/query-keys"
import { toast } from "@/lib/toast"
import { invalidated, renderQueryHook, seed, settle, until } from "@/test/query"
import type { Role } from "@/types/api"
import * as api from "./api"
import {
  useActorNames,
  useChangePoStatus,
  useInvoiceFiled,
  usePoHistory,
  usePoItems,
  usePoUpload,
  usePurchaseOrder,
  usePurchaseOrderByQuotation,
  usePurchaseOrders,
  useRemovePoFile,
  useUpdatePoDetails,
  useUpdatePoItems,
  useUploadPoFile,
} from "./hooks"
import { PO_CONFLICT_MESSAGE } from "./PurchaseOrderDetail/helpers"
import type { PoRow } from "./types"

vi.mock("./api")
vi.mock("@/features/invoices/api")
vi.mock("@/features/users/api")
vi.mock("@/features/auth/hooks", () => ({ useMe: vi.fn() }))
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))
vi.mock("@/lib/storage-upload", () => ({
  uploadWithFreshKey: vi.fn(async (presign: () => Promise<{ objectKey: string }>) => {
    return (await presign()).objectKey
  }),
}))

const m = vi.mocked(api)
const inv = vi.mocked(invoicesApi)

function signedInAs(role: Role | undefined) {
  vi.mocked(useMe).mockReturnValue({
    data: role ? { id: 1, email: "a@gns.id", name: "A", role } : undefined,
  } as ReturnType<typeof useMe>)
}

const poDetail = queryKeys.purchaseOrders.detail(3)
const poItems = queryKeys.purchaseOrders.items(3)
const invList = queryKeys.invoices.list()
const dash = queryKeys.dashboard.summary()
const quotations = queryKeys.quotations.list()

const versionConflict = () => new ApiError(409, null, "row_version mismatch")
const lockRefusal = () =>
  new ApiError(409, { code: "po_locked", detail: "Invoice sudah terbit." }, "Invoice sudah terbit.")
const pdf = () => new File(["x"], "po.pdf", { type: "application/pdf" })

beforeEach(() => {
  vi.clearAllMocks()
  signedInAs("superadmin")
})

describe("PO queries", () => {
  it("lists with the given params", async () => {
    m.list.mockResolvedValue({ rows: [], total: 0 })
    const { result } = renderQueryHook(() => usePurchaseOrders({ status: "PENDING" }))
    await until(() => expect(result.current.isSuccess).toBe(true))
    expect(m.list).toHaveBeenCalledWith({ status: "PENDING" })
  })

  it.each<[string, () => { fetchStatus: string }, () => unknown]>([
    ["PO", () => usePurchaseOrder(undefined), () => m.get],
    ["items", () => usePoItems(0), () => m.listItems],
    ["by quotation", () => usePurchaseOrderByQuotation(undefined), () => m.getByQuotation],
    ["history", () => usePoHistory(0), () => m.listHistory],
  ])("does not fetch %s without an id", async (_name, hook, fn) => {
    const { result } = renderQueryHook(hook)
    await until(() => expect(result.current.fetchStatus).toBe("idle"))
    expect(fn()).not.toHaveBeenCalled()
  })

  it("fetches PO, items, the quotation's PO and history for a real id", async () => {
    m.get.mockResolvedValue({ id: 3 } as never)
    m.listItems.mockResolvedValue([])
    m.getByQuotation.mockResolvedValue(null)
    m.listHistory.mockResolvedValue([])
    const hooks = [
      renderQueryHook(() => usePurchaseOrder(3)),
      renderQueryHook(() => usePoItems(3)),
      renderQueryHook(() => usePurchaseOrderByQuotation(5)),
      renderQueryHook(() => usePoHistory(3)),
    ]
    await until(() => {
      for (const h of hooks) expect(h.result.current.isSuccess).toBe(true)
    })
    expect(m.getByQuotation).toHaveBeenCalledWith(5)
    expect(m.listHistory).toHaveBeenCalledWith(3)
  })

  // One invalidation of purchaseOrders.all must reach the timeline.
  it("keeps the history under the PO prefix", async () => {
    m.listHistory.mockResolvedValue([])
    const { qc, result } = renderQueryHook(() => usePoHistory(3))
    await until(() => expect(result.current.isSuccess).toBe(true))
    await act(() => qc.invalidateQueries({ queryKey: queryKeys.purchaseOrders.all }))
    expect(m.listHistory).toHaveBeenCalledTimes(2)
  })
})

describe("useActorNames", () => {
  it("looks each actor up once and maps id to name", async () => {
    vi.mocked(usersApi.get).mockImplementation(async (id) => ({ id, name: `User ${id}` }) as never)
    const { result } = renderQueryHook(() => useActorNames([1, 2, 1], true))
    await until(() => expect(result.current.size).toBe(2))
    expect(result.current.get(1)).toBe("User 1")
    expect(result.current.get(2)).toBe("User 2")
    expect(usersApi.get).toHaveBeenCalledTimes(2)
  })

  // Only superadmin may read users.
  it("asks nothing when the reader cannot see users", async () => {
    const { result } = renderQueryHook(() => useActorNames([1, 2], false))
    await act(async () => {})
    expect(result.current.size).toBe(0)
    expect(usersApi.get).not.toHaveBeenCalled()
  })
})

describe("useInvoiceFiled", () => {
  it.each<[string, "draft" | "sent" | "paid" | "overdue" | "cancelled" | null, boolean]>([
    ["no invoice", null, false],
    ["draft", "draft", false],
    ["sent", "sent", true],
    ["paid", "paid", true],
    ["overdue", "overdue", true],
    ["cancelled", "cancelled", false],
  ])("reads %s as filed=%s", async (_name, status, want) => {
    inv.getByQuotation.mockResolvedValue(status ? ({ status } as never) : null)
    const { result } = renderQueryHook(() => useInvoiceFiled(5, true))
    await until(() => expect(result.current.data).toBe(want))
  })

  it("does not ask when disabled or without a quotation", async () => {
    const a = renderQueryHook(() => useInvoiceFiled(5, false))
    const b = renderQueryHook(() => useInvoiceFiled(undefined, true))
    await until(() => {
      expect(a.result.current.fetchStatus).toBe("idle")
      expect(b.result.current.fetchStatus).toBe("idle")
    })
    expect(inv.getByQuotation).not.toHaveBeenCalled()
  })

  // A hint only: the server still enforces the lock.
  it("keeps a failed lookup inline instead of throwing", async () => {
    inv.getByQuotation.mockRejectedValue(new ApiError(500, null, "x"))
    const { result } = renderQueryHook(() => useInvoiceFiled(5, true))
    await until(() => expect(result.current.isError).toBe(true))
  })
})

describe("useChangePoStatus", () => {
  it("refreshes POs, invoices and dashboard", async () => {
    m.changeStatus.mockResolvedValue(undefined)
    const { qc, result } = renderQueryHook(() => useChangePoStatus())
    seed(qc, [poDetail, invList, dash, quotations])
    await settle(() => result.current.mutateAsync({ id: 3, status: "CANCELLED", note: "Batal" }))
    expect(m.changeStatus).toHaveBeenCalledWith(3, "CANCELLED", "Batal")
    expect(invalidated(qc, [poDetail, invList, dash, quotations])).toEqual([
      poDetail,
      invList,
      dash,
    ])
  })

  it("leaves the completeness 422 to its modal", async () => {
    m.changeStatus.mockRejectedValue(
      new ApiError(
        422,
        { fields: { "klien:1": "Data klien PT A belum lengkap: NPWP" } },
        "Data belum lengkap.",
      ),
    )
    const { result } = renderQueryHook(() => useChangePoStatus())
    await settle(() => result.current.mutateAsync({ id: 3, status: "ON_PROGRESS" }))
    expect(toast.error).not.toHaveBeenCalled()
  })

  it("toasts any other failure", async () => {
    m.changeStatus.mockRejectedValue(new ApiError(422, { fields: { note: "Wajib." } }, ""))
    const { result } = renderQueryHook(() => useChangePoStatus())
    await settle(() => result.current.mutateAsync({ id: 3, status: "CANCELLED" }))
    expect(toast.error).toHaveBeenCalledWith("Gagal mengubah status PO.")
  })
})

describe("PO writes", () => {
  it("details save with the row version and refresh POs", async () => {
    m.updateDetails.mockResolvedValue(undefined)
    const { qc, result } = renderQueryHook(() => useUpdatePoDetails())
    seed(qc, [poDetail, dash])
    await settle(() =>
      result.current.mutateAsync({ id: 3, poNumber: "PO-1", poDate: "2026-09-24", rowVersion: 4 }),
    )
    expect(m.updateDetails).toHaveBeenCalledWith(3, { poNumber: "PO-1", poDate: "2026-09-24" }, 4)
    expect(invalidated(qc, [poDetail, dash])).toEqual([poDetail])
  })

  it("remove file refreshes POs and dashboard", async () => {
    m.removeFile.mockResolvedValue(undefined)
    const { qc, result } = renderQueryHook(() => useRemovePoFile())
    seed(qc, [poDetail, dash, invList])
    await settle(() => result.current.mutateAsync(3))
    expect(invalidated(qc, [poDetail, dash, invList])).toEqual([poDetail, dash])
  })

  it("upload attaches name, size and key, then refreshes POs and dashboard", async () => {
    m.presignUpload.mockResolvedValue({ uploadUrl: "/u", objectKey: "po/3/po.pdf", expiresAt: 1 })
    m.updateFile.mockResolvedValue(undefined)
    const { qc, result } = renderQueryHook(() => useUploadPoFile())
    seed(qc, [poDetail, dash])
    await settle(() => result.current.mutateAsync({ id: 3, file: pdf() }))
    expect(m.updateFile).toHaveBeenCalledWith(3, {
      fileName: "po.pdf",
      fileSize: 1,
      objectKey: "po/3/po.pdf",
    })
    expect(invalidated(qc, [poDetail, dash])).toEqual([poDetail, dash])
  })

  it("upload refuses a disallowed file before storage", async () => {
    const { result } = renderQueryHook(() => useUploadPoFile())
    await settle(() => result.current.mutateAsync({ id: 3, file: new File(["x"], "po.exe") }))
    expect(m.presignUpload).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith(
      "Format dokumen PO tidak didukung. Gunakan: .pdf, .png, .jpg, .jpeg, .webp, .xlsx, .xls.",
    )
  })

  it("items save refreshes POs, the PO's items and dashboard", async () => {
    m.updateItems.mockResolvedValue({ id: 3, rowVersion: 5 })
    const { qc, result } = renderQueryHook(() => useUpdatePoItems())
    seed(qc, [poDetail, poItems, dash, invList])
    await settle(() => result.current.mutateAsync({ id: 3, input: {} as never, rowVersion: 4 }))
    expect(m.updateItems).toHaveBeenCalledWith(3, {}, 4)
    expect(invalidated(qc, [poDetail, poItems, dash, invList])).toEqual([poDetail, poItems, dash])
  })

  // A stale version and a lock both mean the stored PO moved on.
  it.each<[string, () => ApiError, string]>([
    ["version conflict", versionConflict, PO_CONFLICT_MESSAGE],
    ["lock refusal", lockRefusal, "Invoice sudah terbit."],
  ])("reloads the PO after a %s", async (_name, err, msg) => {
    m.updateItems.mockRejectedValue(err())
    const { qc, result } = renderQueryHook(() => useUpdatePoItems())
    seed(qc, [poDetail, dash])
    await settle(() => result.current.mutateAsync({ id: 3, input: {} as never, rowVersion: 4 }))
    expect(toast.error).toHaveBeenCalledWith(msg)
    expect(invalidated(qc, [poDetail, dash])).toEqual([poDetail])
  })

  it.each<
    [string, () => { mutateAsync: (v: never) => Promise<unknown> }, () => void, unknown, string]
  >([
    [
      "details",
      useUpdatePoDetails,
      () => m.updateDetails.mockRejectedValue(new Error("")),
      { id: 3, poNumber: "a", poDate: "b", rowVersion: 1 },
      "Gagal memperbarui detail PO.",
    ],
    [
      "remove",
      useRemovePoFile,
      () => m.removeFile.mockRejectedValue(new Error("")),
      3,
      "Gagal menghapus berkas PO.",
    ],
    [
      "upload",
      useUploadPoFile,
      () => m.presignUpload.mockRejectedValue(new Error("")),
      { id: 3, file: pdf() },
      "Gagal mengunggah berkas PO.",
    ],
    [
      "items",
      useUpdatePoItems,
      () => m.updateItems.mockRejectedValue(new Error("")),
      { id: 3, input: {}, rowVersion: 1 },
      "Gagal memperbarui item PO.",
    ],
  ])("%s toasts Indonesian copy without reloading", async (_name, hook, fail, vars, msg) => {
    fail()
    const { qc, result } = renderQueryHook(hook)
    seed(qc, [poDetail])
    await settle(() => result.current.mutateAsync(vars as never))
    expect(toast.error).toHaveBeenCalledWith(msg)
    expect(invalidated(qc, [poDetail])).toEqual([])
  })
})

describe("usePoUpload", () => {
  const row: PoRow = {
    id: 3,
    quotationId: 5,
    quotationNo: "Q/1",
    poNumber: "PO-1",
    poDate: "2026-09-01T00:00:00+07:00",
    companyClientId: 1,
    client: "PT A",
    date: "",
    total: "0",
    status: "UPLOADED",
    rowVersion: 4,
  }
  const same = { poNumber: "PO-1", poDate: "2026-09-01" }
  const changed = { poNumber: "PO-2", poDate: "2026-09-02" }

  beforeEach(() => {
    m.updateDetails.mockResolvedValue(undefined)
    m.presignUpload.mockResolvedValue({ uploadUrl: "/u", objectKey: "k", expiresAt: 1 })
    m.updateFile.mockResolvedValue(undefined)
  })

  async function save(r: PoRow | undefined, file: File | null, details: typeof same) {
    const hook = renderQueryHook(() => usePoUpload(r))
    let ok = false
    await act(async () => {
      ok = await hook.result.current.save(file, details)
    })
    return { ok, hook }
  }

  // Attaching bumps row_version, so details go first on the loaded version.
  it("saves changed details before attaching the file", async () => {
    const order: string[] = []
    m.updateDetails.mockImplementation(async () => {
      order.push("details")
    })
    m.updateFile.mockImplementation(async () => {
      order.push("file")
    })
    const { ok } = await save(row, pdf(), changed)
    expect(ok).toBe(true)
    expect(order).toEqual(["details", "file"])
    expect(m.updateDetails).toHaveBeenCalledWith(3, changed, 4)
  })

  it("skips the details write when nothing changed", async () => {
    const { ok } = await save(row, pdf(), same)
    expect(ok).toBe(true)
    expect(m.updateDetails).not.toHaveBeenCalled()
    expect(m.updateFile).toHaveBeenCalledTimes(1)
  })

  it("saves details alone when no file is picked", async () => {
    const { ok } = await save(row, null, changed)
    expect(ok).toBe(true)
    expect(m.presignUpload).not.toHaveBeenCalled()
  })

  it("refuses to save without a row", async () => {
    const { ok } = await save(undefined, pdf(), changed)
    expect(ok).toBe(false)
    expect(m.updateDetails).not.toHaveBeenCalled()
  })

  // Roles that cannot read invoices learn of the lock from a refused save.
  it("locks the details of that PO after a lock refusal", async () => {
    m.updateDetails.mockRejectedValue(lockRefusal())
    const { ok, hook } = await save(row, pdf(), changed)
    expect(ok).toBe(false)
    expect(m.updateFile).not.toHaveBeenCalled()
    expect(hook.result.current.detailsLocked).toBe(true)
  })

  it("does not lock after a plain version conflict", async () => {
    m.updateDetails.mockRejectedValue(versionConflict())
    const { ok, hook } = await save(row, null, changed)
    expect(ok).toBe(false)
    expect(hook.result.current.detailsLocked).toBe(false)
  })

  it("does not lock the details when the file step is refused", async () => {
    m.updateFile.mockRejectedValue(lockRefusal())
    const { ok, hook } = await save(row, pdf(), same)
    expect(ok).toBe(false)
    expect(hook.result.current.detailsLocked).toBe(false)
  })

  it("locks the details of a delivered PO once its invoice is filed", async () => {
    inv.getByQuotation.mockResolvedValue({ status: "sent" } as never)
    const { result } = renderQueryHook(() => usePoUpload({ ...row, status: "DELIVERED" }))
    expect(result.current.checking).toBe(true)
    await until(() => expect(result.current.detailsLocked).toBe(true))
    expect(result.current.checking).toBe(false)
    expect(inv.getByQuotation).toHaveBeenCalledWith(5)
  })

  it.each<[string, PoRow["status"], Role | undefined]>([
    ["a PO not yet delivered", "ON_PROGRESS", "superadmin"],
    ["a role without invoice access", "DELIVERED", "operational"],
    ["an unknown role", "DELIVERED", undefined],
  ])("does not check the invoice for %s", async (_name, status, role) => {
    signedInAs(role)
    const { result } = renderQueryHook(() => usePoUpload({ ...row, status }))
    await act(async () => {})
    expect(inv.getByQuotation).not.toHaveBeenCalled()
    expect(result.current).toMatchObject({ detailsLocked: false, checking: false })
  })

  it("reports pending while a save runs", async () => {
    let finish: () => void = () => {}
    m.updateFile.mockReturnValue(new Promise<void>((r) => (finish = r)))
    const { result } = renderQueryHook(() => usePoUpload(row))
    let run: Promise<boolean> = Promise.resolve(false)
    await act(async () => {
      run = result.current.save(pdf(), same)
    })
    await until(() => expect(result.current.isPending).toBe(true))
    await act(async () => {
      finish()
      await run
    })
    await until(() => expect(result.current.isPending).toBe(false))
  })
})
