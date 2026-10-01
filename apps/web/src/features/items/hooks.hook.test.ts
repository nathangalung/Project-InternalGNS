import { beforeEach, describe, expect, it, vi } from "vitest"
import * as vendorsApi from "@/features/vendors/api"
import { shrinkImage } from "@/lib/image-shrink"
import { queryKeys } from "@/lib/query-keys"
import { uploadWithFreshKey } from "@/lib/storage-upload"
import { toast } from "@/lib/toast"
import { invalidated, renderQueryHook, seed, settle, until } from "@/test/query"
import * as api from "./api"
import {
  useActiveVendorOptions,
  useAddVendorToItem,
  useCreateItem,
  useItem,
  useItemImage,
  useItemImageDownloadUrl,
  useItemPriceHistory,
  useItemSearchAdvanced,
  useItems,
  useItemVendors,
  useRemoveItemImage,
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
vi.mock("@/lib/image-shrink", () => ({ shrinkImage: vi.fn(async (f: File) => f) }))
vi.mock("@/hooks/useObjectUrl", () => ({
  useObjectUrl: (path?: string) => (path ? `blob:${path}` : ""),
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

  // MD-02: every vendor stays reachable.
  //
  // Not just the first page.
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

  // Vendor tabs show item names.
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

  // Vendor detail, counts change too.
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

  it("uploads the shrunk copy, so a large photo that shrinks under the cap passes", async () => {
    const big = img(8 * 1024 * 1024)
    const small = new File([new Uint8Array(10)], "foto-kecil.webp", { type: "image/webp" })
    vi.mocked(shrinkImage).mockResolvedValueOnce(small)
    m.presignImageUpload.mockResolvedValue({
      uploadUrl: "/u",
      objectKey: "items/9/k.webp",
      expiresAt: 1,
    })
    m.updateImage.mockResolvedValue(undefined)
    const { result } = renderQueryHook(() => useUploadItemImage())
    await settle(() => result.current.mutateAsync({ id: 9, file: big }))
    expect(shrinkImage).toHaveBeenCalledWith(big)
    expect(m.presignImageUpload).toHaveBeenCalledWith(9, "foto-kecil.webp")
    expect(vi.mocked(uploadWithFreshKey).mock.calls[0][1]).toBe(small)
  })

  // MD-13: refused files skip storage.
  it("refuses an oversize image before asking for an upload URL", async () => {
    const { result } = renderQueryHook(() => useUploadItemImage())
    await settle(() => result.current.mutateAsync({ id: 9, file: img(5 * 1024 * 1024 + 1) }))
    expect(m.presignImageUpload).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith("Ukuran foto produk melebihi 5 MB.")
  })

  it("falls back to Indonesian copy when the upload fails without a reason", async () => {
    m.presignImageUpload.mockRejectedValue(new Error(""))
    const { result } = renderQueryHook(() => useUploadItemImage())
    await settle(() => result.current.mutateAsync({ id: 9, file: img() }))
    expect(toast.error).toHaveBeenCalledWith("Gagal mengunggah foto produk.")
  })
})

describe("useRemoveItemImage", () => {
  it("removes the image and refreshes item views", async () => {
    m.removeImage.mockResolvedValue(undefined)
    const { qc, result } = renderQueryHook(() => useRemoveItemImage())
    seed(qc, [detail, list])
    await settle(() => result.current.mutateAsync(9))
    expect(m.removeImage).toHaveBeenCalledWith(9)
    expect(invalidated(qc, [detail, list])).toEqual([detail, list])
  })

  it("shows Indonesian copy when the removal fails without a reason", async () => {
    m.removeImage.mockRejectedValue(new Error(""))
    const { result } = renderQueryHook(() => useRemoveItemImage())
    await settle(() => result.current.mutateAsync(9))
    expect(toast.error).toHaveBeenCalledWith("Gagal menghapus foto produk.")
  })
})

describe("useItemImage", () => {
  it("is empty for a product without an image", async () => {
    const { result } = renderQueryHook(() => useItemImage(9, undefined))
    await until(() => expect(result.current).toBe(""))
    expect(m.presignImageDownload).not.toHaveBeenCalled()
  })

  it("resolves the stored image to a blob URL", async () => {
    m.presignImageDownload.mockResolvedValue({ downloadUrl: "/storage/object?k=1", expiresAt: 1 })
    const { result } = renderQueryHook(() => useItemImage(9, "items/9/a.webp"))
    await until(() => expect(result.current).toBe("blob:/storage/object?k=1"))
    expect(m.presignImageDownload).toHaveBeenCalledWith(9)
  })
})

describe("useRemoveItemImage settling", () => {
  it("stays pending until the item views have refetched", async () => {
    m.removeImage.mockResolvedValue(undefined)
    const { qc, result } = renderQueryHook(() => useRemoveItemImage())
    let refetched: () => void = () => {}
    vi.spyOn(qc, "invalidateQueries").mockReturnValue(
      new Promise<void>((r) => {
        refetched = r
      }),
    )
    let settled = false
    const run = result.current.mutateAsync(9).then(() => {
      settled = true
    })
    await until(() => expect(qc.invalidateQueries).toHaveBeenCalledTimes(2))
    await new Promise((r) => setTimeout(r, 20))
    expect(settled).toBe(false)
    refetched()
    await run
    expect(settled).toBe(true)
  })
})
