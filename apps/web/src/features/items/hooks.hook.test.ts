import { beforeEach, describe, expect, it, vi } from "vitest"
import * as vendorsApi from "@/features/vendors/api"
import { queryKeys } from "@/lib/query-keys"
import { toast } from "@/lib/toast"
import { invalidated, renderQueryHook, seed, settle, until } from "@/test/query"
import * as api from "./api"
import {
  useActiveVendorOptions,
  useAddVendorToItem,
  useCreateItem,
  useItem,
  useItemImageDownloadUrl,
  useItemPriceHistory,
  useItemSearchAdvanced,
  useItems,
  useItemVendors,
  useUpdateItem,
  useUploadItemImage,
} from "./hooks"

vi.mock("./api")
vi.mock("@/features/vendors/api")
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))
vi.mock("@/lib/storage-upload", () => ({
  uploadWithFreshKey: vi.fn(async (presign: () => Promise<{ objectKey: string }>) => {
    return (await presign()).objectKey
  }),
}))

const m = vi.mocked(api)
const vendors = vi.mocked(vendorsApi)
const detail = queryKeys.items.detail(9)
const list = queryKeys.items.list()
const vendorDetail = queryKeys.vendors.detail(4)

beforeEach(() => vi.clearAllMocks())

describe("item queries", () => {
  it("lists with the given params", async () => {
    m.list.mockResolvedValue({ rows: [], total: 0 })
    const { result } = renderQueryHook(() => useItems({ unitId: 2 }))
    await until(() => expect(result.current.isSuccess).toBe(true))
    expect(m.list).toHaveBeenCalledWith({ unitId: 2 })
  })

  it("holds the list while disabled", async () => {
    const { result } = renderQueryHook(() => useItems({}, { enabled: false }))
    await until(() => expect(result.current.fetchStatus).toBe("idle"))
    expect(m.list).not.toHaveBeenCalled()
  })

  it.each<[string, () => { fetchStatus: string }, () => unknown]>([
    ["item", () => useItem(undefined), () => m.get],
    ["item vendors", () => useItemVendors(0), () => m.listVendors],
    ["price history", () => useItemPriceHistory(undefined, 5), () => m.priceHistory],
    ["image url without a key", () => useItemImageDownloadUrl(9), () => m.presignImageDownload],
    [
      "image url without an id",
      () => useItemImageDownloadUrl(undefined, "k"),
      () => m.presignImageDownload,
    ],
  ])("does not fetch %s without an id", async (_name, hook, fn) => {
    const { result } = renderQueryHook(hook)
    await until(() => expect(result.current.fetchStatus).toBe("idle"))
    expect(fn()).not.toHaveBeenCalled()
  })

  it("fetches item, vendors, history and image for a real id", async () => {
    m.get.mockResolvedValue({ id: 9 } as never)
    m.listVendors.mockResolvedValue([])
    m.priceHistory.mockResolvedValue([])
    m.presignImageDownload.mockResolvedValue({ downloadUrl: "u", expiresAt: 1 })
    const item = renderQueryHook(() => useItem(9))
    const vs = renderQueryHook(() => useItemVendors(9))
    const hist = renderQueryHook(() => useItemPriceHistory(9, 5))
    const img = renderQueryHook(() => useItemImageDownloadUrl(9, "k"))
    await until(() => {
      expect(item.result.current.isSuccess).toBe(true)
      expect(vs.result.current.isSuccess).toBe(true)
      expect(hist.result.current.isSuccess).toBe(true)
      expect(img.result.current.isSuccess).toBe(true)
    })
    expect(m.get).toHaveBeenCalledWith(9)
    expect(m.listVendors).toHaveBeenCalledWith(9)
    expect(m.priceHistory).toHaveBeenCalledWith(9, { limit: 5 })
  })

  it("searches only a non-blank term, with its paging", async () => {
    m.searchAdvanced.mockResolvedValue({ hits: [], total: 0, counts: {} } as never)
    const blank = renderQueryHook(() => useItemSearchAdvanced(" "))
    await until(() => expect(blank.result.current.fetchStatus).toBe("idle"))
    const { result } = renderQueryHook(() =>
      useItemSearchAdvanced("baut", { limit: 10, offset: 20 }),
    )
    await until(() => expect(result.current.isSuccess).toBe(true))
    expect(m.searchAdvanced).toHaveBeenCalledTimes(1)
    expect(m.searchAdvanced).toHaveBeenCalledWith("baut", { limit: 10, offset: 20 })
  })

  // MD-02: every vendor must be reachable, not just the first page.
  it("asks the server for active vendors matching the trimmed term", async () => {
    vendors.list.mockResolvedValue({ rows: [], total: 0 })
    const { result } = renderQueryHook(() => useActiveVendorOptions("  sinar  "))
    await until(() => expect(result.current.isSuccess).toBe(true))
    expect(vendors.list).toHaveBeenCalledWith({ q: "sinar", isActive: true, limit: 10 })
  })

  it("does not list vendors for a blank term", async () => {
    const { result } = renderQueryHook(() => useActiveVendorOptions("   ", 20))
    await until(() => expect(result.current.fetchStatus).toBe("idle"))
    expect(vendors.list).not.toHaveBeenCalled()
  })
})

describe("item writes", () => {
  it("refreshes item views after a create", async () => {
    m.create.mockResolvedValue({ id: 9 } as never)
    const { qc, result } = renderQueryHook(() => useCreateItem())
    seed(qc, [list, vendorDetail])
    await settle(() => result.current.mutateAsync({ name: "Baut" }))
    expect(invalidated(qc, [list, vendorDetail])).toEqual([list])
  })

  // Vendor product tabs show item names.
  it("refreshes items and vendors after an update", async () => {
    m.update.mockResolvedValue({ id: 9 } as never)
    const { qc, result } = renderQueryHook(() => useUpdateItem())
    const quotations = queryKeys.quotations.list()
    seed(qc, [detail, vendorDetail, quotations])
    await settle(() =>
      result.current.mutateAsync({ id: 9, input: { name: "Baut", isActive: true } }),
    )
    expect(invalidated(qc, [detail, vendorDetail, quotations])).toEqual([detail, vendorDetail])
  })

  it("toasts Indonesian copy when an update fails", async () => {
    m.update.mockRejectedValue(new Error(""))
    const { result } = renderQueryHook(() => useUpdateItem())
    await settle(() => result.current.mutateAsync({ id: 9, input: { name: "B", isActive: true } }))
    expect(toast.error).toHaveBeenCalledWith("Gagal memperbarui produk.")
  })

  // Vendor detail and counts change too.
  it("refreshes the item's vendors and every vendor view after linking one", async () => {
    m.addVendor.mockResolvedValue({ id: 1 } as never)
    const { qc, result } = renderQueryHook(() => useAddVendorToItem())
    const itemVendors = queryKeys.items.vendors(9)
    const otherItem = queryKeys.items.vendors(10)
    seed(qc, [itemVendors, otherItem, vendorDetail, detail])
    await settle(() => result.current.mutateAsync({ itemId: 9, input: { vendorId: 4 } }))
    expect(m.addVendor).toHaveBeenCalledWith(9, { vendorId: 4 })
    expect(invalidated(qc, [itemVendors, otherItem, vendorDetail, detail])).toEqual([
      itemVendors,
      vendorDetail,
    ])
  })
})

describe("useUploadItemImage", () => {
  const img = (size = 10) => new File([new Uint8Array(size)], "foto.webp", { type: "image/webp" })

  it("uploads, saves the key, and refreshes item views", async () => {
    m.presignImageUpload.mockResolvedValue({
      uploadUrl: "/u",
      objectKey: "items/9/f.webp",
      expiresAt: 1,
    })
    m.updateImage.mockResolvedValue(undefined)
    const { qc, result } = renderQueryHook(() => useUploadItemImage())
    seed(qc, [detail, list])
    await settle(() => result.current.mutateAsync({ id: 9, file: img() }))
    expect(m.presignImageUpload).toHaveBeenCalledWith(9, "foto.webp")
    expect(m.updateImage).toHaveBeenCalledWith(9, "items/9/f.webp")
    expect(invalidated(qc, [detail, list])).toEqual([detail, list])
  })

  // MD-13: a refused file never reaches storage.
  it("refuses an oversize image before asking for an upload URL", async () => {
    const { result } = renderQueryHook(() => useUploadItemImage())
    await settle(() => result.current.mutateAsync({ id: 9, file: img(5 * 1024 * 1024 + 1) }))
    expect(m.presignImageUpload).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith("Ukuran gambar produk melebihi 5 MB.")
  })

  it("falls back to Indonesian copy when the upload fails without a reason", async () => {
    m.presignImageUpload.mockRejectedValue(new Error(""))
    const { result } = renderQueryHook(() => useUploadItemImage())
    await settle(() => result.current.mutateAsync({ id: 9, file: img() }))
    expect(toast.error).toHaveBeenCalledWith("Gagal mengunggah gambar produk.")
  })
})
