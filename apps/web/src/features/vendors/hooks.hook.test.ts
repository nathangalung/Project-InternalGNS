import { beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "@/lib/api-client"
import { queryKeys } from "@/lib/query-keys"
import { toast } from "@/lib/toast"
import { invalidated, renderQueryHook, seed, settle, until } from "@/test/query"
import * as api from "./api"
import {
  useCreateVendor,
  useUpdateVendor,
  useUploadVendorLogo,
  useVendor,
  useVendorItems,
  useVendorLogoDownloadUrl,
  useVendors,
} from "./hooks"

vi.mock("./api")
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))
vi.mock("@/lib/storage-upload", () => ({
  uploadWithFreshKey: vi.fn(async (presign: () => Promise<{ objectKey: string }>) => {
    return (await presign()).objectKey
  }),
}))

const m = vi.mocked(api)
const detail = queryKeys.vendors.detail(4)
const list = queryKeys.vendors.list()

beforeEach(() => vi.clearAllMocks())

describe("vendor queries", () => {
  it("lists with the given params", async () => {
    m.list.mockResolvedValue({ rows: [], total: 0 })
    const { result } = renderQueryHook(() => useVendors({ q: "baja" }))
    await until(() => expect(result.current.isSuccess).toBe(true))
    expect(m.list).toHaveBeenCalledWith({ q: "baja" })
  })

  it.each([undefined, 0])("does not fetch vendor %s", async (id) => {
    const { result } = renderQueryHook(() => useVendor(id))
    await until(() => expect(result.current.fetchStatus).toBe("idle"))
    expect(m.get).not.toHaveBeenCalled()
  })

  it("fetches a real vendor", async () => {
    m.get.mockResolvedValue({ id: 4 } as never)
    const { result } = renderQueryHook(() => useVendor(4))
    await until(() => expect(result.current.data).toEqual({ id: 4 }))
  })

  it("pages the vendor's products", async () => {
    m.listItems.mockResolvedValue({ rows: [], total: 60 })
    const idle = renderQueryHook(() => useVendorItems(undefined, { limit: 10, offset: 0 }))
    await until(() => expect(idle.result.current.fetchStatus).toBe("idle"))
    const { result } = renderQueryHook(() => useVendorItems(4, { limit: 10, offset: 50 }))
    await until(() => expect(result.current.data?.total).toBe(60))
    expect(m.listItems).toHaveBeenCalledTimes(1)
    expect(m.listItems).toHaveBeenCalledWith(4, { limit: 10, offset: 50 })
  })

  it("presigns the logo only when there is one", async () => {
    m.presignLogoDownload.mockResolvedValue({ downloadUrl: "u", expiresAt: 1 })
    const none = renderQueryHook(() => useVendorLogoDownloadUrl(4))
    await until(() => expect(none.result.current.fetchStatus).toBe("idle"))
    const noId = renderQueryHook(() => useVendorLogoDownloadUrl(undefined, "k"))
    await until(() => expect(noId.result.current.fetchStatus).toBe("idle"))
    expect(m.presignLogoDownload).not.toHaveBeenCalled()
    const { result } = renderQueryHook(() => useVendorLogoDownloadUrl(4, "k"))
    await until(() => expect(result.current.data?.downloadUrl).toBe("u"))
  })
})

describe("vendor writes", () => {
  it("refreshes vendor views after a create", async () => {
    m.create.mockResolvedValue({ id: 4 } as never)
    const { qc, result } = renderQueryHook(() => useCreateVendor())
    seed(qc, [list, queryKeys.items.list()])
    await settle(() => result.current.mutateAsync({ name: "CV B" }))
    expect(invalidated(qc, [list, queryKeys.items.list()])).toEqual([list])
  })

  // PO lines and item vendor lists carry the vendor name.
  it("refreshes the lists that print the vendor name, and nothing else", async () => {
    m.update.mockResolvedValue({ id: 4 } as never)
    const { qc, result } = renderQueryHook(() => useUpdateVendor())
    const itemVendors = queryKeys.items.vendors(9)
    const poItems = queryKeys.purchaseOrders.items(3)
    const itemDetail = queryKeys.items.detail(9)
    const poDetail = queryKeys.purchaseOrders.detail(3)
    const keys = [detail, itemVendors, poItems, itemDetail, poDetail]
    seed(qc, keys)
    await settle(() =>
      result.current.mutateAsync({ id: 4, input: { name: "CV B", isActive: true } }),
    )
    expect(invalidated(qc, keys)).toEqual([detail, itemVendors, poItems])
  })

  it("toasts the server reason when an update fails", async () => {
    m.update.mockRejectedValue(new ApiError(409, null, "Nama vendor sudah dipakai."))
    const { result } = renderQueryHook(() => useUpdateVendor())
    await settle(() => result.current.mutateAsync({ id: 4, input: { name: "B", isActive: true } }))
    expect(toast.error).toHaveBeenCalledWith("Nama vendor sudah dipakai.")
  })
})

describe("useUploadVendorLogo", () => {
  const png = (size = 10) => new File([new Uint8Array(size)], "l.png", { type: "image/png" })

  it("uploads, saves the key, and refreshes the detail only", async () => {
    m.presignLogoUpload.mockResolvedValue({
      uploadUrl: "/u",
      objectKey: "vendors/4/l.png",
      expiresAt: 1,
    })
    m.updateLogo.mockResolvedValue(undefined)
    const { qc, result } = renderQueryHook(() => useUploadVendorLogo())
    seed(qc, [detail, list])
    await settle(() => result.current.mutateAsync({ id: 4, file: png() }))
    expect(m.updateLogo).toHaveBeenCalledWith(4, "vendors/4/l.png")
    expect(invalidated(qc, [detail, list])).toEqual([detail])
  })

  // MD-13: a refused file never reaches storage.
  it("refuses a non-image before asking for an upload URL", async () => {
    const { result } = renderQueryHook(() => useUploadVendorLogo())
    const pdf = new File(["x"], "logo.pdf", { type: "application/pdf" })
    await settle(() => result.current.mutateAsync({ id: 4, file: pdf }))
    expect(m.presignLogoUpload).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith(
      "Format logo vendor tidak didukung. Gunakan: .png, .jpg, .jpeg, .webp, .gif.",
    )
  })

  it("falls back to Indonesian copy when the upload fails without a reason", async () => {
    m.presignLogoUpload.mockRejectedValue(new Error(""))
    const { result } = renderQueryHook(() => useUploadVendorLogo())
    await settle(() => result.current.mutateAsync({ id: 4, file: png() }))
    expect(toast.error).toHaveBeenCalledWith("Gagal mengunggah logo vendor.")
  })
})
