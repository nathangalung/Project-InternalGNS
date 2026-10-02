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
  useAddItemImages,
  useAddVendorToItem,
  useCreateItem,
  useDeleteItemImage,
  useItem,
  useItemGallery,
  useItemImage,
  useItemImageDownloadUrl,
  useItemPriceHistory,
  useItemSearchAdvanced,
  useItems,
  useItemVendors,
  useLineRecommendation,
  useSetItemCover,
  useUpdateItem,
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

describe("useItemGallery", () => {
  it("waits for an id", async () => {
    const { result } = renderQueryHook(() => useItemGallery(undefined))
    await until(() => expect(result.current.fetchStatus).toBe("idle"))
    expect(m.listImages).not.toHaveBeenCalled()
  })

  it("lists the product's photos", async () => {
    m.listImages.mockResolvedValue({ max: 8, images: [] })
    const { result } = renderQueryHook(() => useItemGallery(9))
    await until(() => expect(result.current.data).toEqual({ max: 8, images: [] }))
    expect(m.listImages).toHaveBeenCalledWith(9)
  })
})

describe("useAddItemImages", () => {
  const img = (name: string, size = 10) =>
    new File([new Uint8Array(size)], name, { type: "image/webp" })
  const photos = queryKeys.items.images(9)

  it("adds each picked photo in turn and refreshes every photo view", async () => {
    m.presignImageUpload.mockImplementation(async (_id, name) => ({
      uploadUrl: "/u",
      objectKey: `items/9/${name}`,
      expiresAt: 1,
    }))
    m.addImage.mockResolvedValue(undefined)
    const { qc, result } = renderQueryHook(() => useAddItemImages())
    seed(qc, [detail, list, photos])
    await settle(() => result.current.mutateAsync({ id: 9, files: [img("a.webp"), img("b.webp")] }))
    expect(m.addImage.mock.calls).toEqual([
      [9, "items/9/a.webp"],
      [9, "items/9/b.webp"],
    ])
    expect(invalidated(qc, [detail, list, photos])).toEqual([detail, list, photos])
  })

  it("uploads the shrunk copy, so a large photo that shrinks under the cap passes", async () => {
    const big = img("foto.webp", 8 * 1024 * 1024)
    const small = img("foto-kecil.webp")
    vi.mocked(shrinkImage).mockResolvedValueOnce(small)
    m.presignImageUpload.mockResolvedValue({
      uploadUrl: "/u",
      objectKey: "items/9/k.webp",
      expiresAt: 1,
    })
    m.addImage.mockResolvedValue(undefined)
    const { result } = renderQueryHook(() => useAddItemImages())
    await settle(() => result.current.mutateAsync({ id: 9, files: [big] }))
    expect(shrinkImage).toHaveBeenCalledWith(big)
    expect(m.presignImageUpload).toHaveBeenCalledWith(9, "foto-kecil.webp")
    expect(vi.mocked(uploadWithFreshKey).mock.calls[0][1]).toBe(small)
  })

  // MD-13: refused files skip storage.
  it("stops at an oversize photo, keeping the ones already added", async () => {
    m.presignImageUpload.mockResolvedValue({
      uploadUrl: "/u",
      objectKey: "items/9/a.webp",
      expiresAt: 1,
    })
    m.addImage.mockResolvedValue(undefined)
    const { qc, result } = renderQueryHook(() => useAddItemImages())
    seed(qc, [photos])
    await settle(() =>
      result.current.mutateAsync({
        id: 9,
        files: [img("a.webp"), img("besar.webp", 5 * 1024 * 1024 + 1), img("c.webp")],
      }),
    )
    expect(m.addImage).toHaveBeenCalledTimes(1)
    expect(toast.error).toHaveBeenCalledWith("Ukuran foto produk melebihi 5 MB.")
    expect(invalidated(qc, [photos])).toEqual([photos])
  })

  it("shows the server's refusal, else Indonesian copy", async () => {
    m.presignImageUpload.mockResolvedValue({
      uploadUrl: "/u",
      objectKey: "items/9/a.webp",
      expiresAt: 1,
    })
    m.addImage.mockRejectedValueOnce(new Error("Maksimal 8 foto per produk."))
    const { result } = renderQueryHook(() => useAddItemImages())
    await settle(() => result.current.mutateAsync({ id: 9, files: [img("a.webp")] }))
    expect(toast.error).toHaveBeenCalledWith("Maksimal 8 foto per produk.")
    m.presignImageUpload.mockRejectedValue(new Error(""))
    await settle(() => result.current.mutateAsync({ id: 9, files: [img("a.webp")] }))
    expect(toast.error).toHaveBeenLastCalledWith("Gagal mengunggah foto produk.")
  })
})

describe("photo changes", () => {
  const photos = queryKeys.items.images(9)

  it.each<
    [
      string,
      () => { mutateAsync: (v: { id: number; imageId: number }) => Promise<unknown> },
      () => unknown,
    ]
  >([
    ["delete", useDeleteItemImage, () => m.deleteImage],
    ["cover", useSetItemCover, () => m.setCoverImage],
  ])("%s calls the api and refreshes every photo view", async (_name, hook, fn) => {
    vi.mocked(fn() as () => Promise<void>).mockResolvedValue(undefined)
    const { qc, result } = renderQueryHook(hook)
    seed(qc, [detail, list, photos])
    await settle(() => result.current.mutateAsync({ id: 9, imageId: 4 }))
    expect(fn()).toHaveBeenCalledWith(9, 4)
    expect(invalidated(qc, [detail, list, photos])).toEqual([detail, list, photos])
  })

  it.each<
    [
      string,
      () => { mutateAsync: (v: { id: number; imageId: number }) => Promise<unknown> },
      () => unknown,
      string,
    ]
  >([
    ["delete", useDeleteItemImage, () => m.deleteImage, "Gagal menghapus foto produk."],
    ["cover", useSetItemCover, () => m.setCoverImage, "Gagal mengubah foto utama."],
  ])("%s falls back to Indonesian copy", async (_name, hook, fn, msg) => {
    vi.mocked(fn() as () => Promise<void>).mockRejectedValue(new Error(""))
    const { result } = renderQueryHook(hook)
    await settle(() => result.current.mutateAsync({ id: 9, imageId: 4 }))
    expect(toast.error).toHaveBeenCalledWith(msg)
  })

  it("a delete stays pending until the photo views have refetched", async () => {
    m.deleteImage.mockResolvedValue(undefined)
    const { qc, result } = renderQueryHook(() => useDeleteItemImage())
    let refetched: () => void = () => {}
    vi.spyOn(qc, "invalidateQueries").mockReturnValue(
      new Promise<void>((r) => {
        refetched = r
      }),
    )
    let settled = false
    const run = result.current.mutateAsync({ id: 9, imageId: 4 }).then(() => {
      settled = true
    })
    await until(() => expect(qc.invalidateQueries).toHaveBeenCalledTimes(1))
    await new Promise((r) => setTimeout(r, 20))
    expect(settled).toBe(false)
    refetched()
    await run
    expect(settled).toBe(true)
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

describe("useLineRecommendation", () => {
  it("waits for an item", async () => {
    const { result } = renderQueryHook(() => useLineRecommendation(undefined, 3))
    await until(() => expect(result.current.fetchStatus).toBe("idle"))
    expect(m.recommend).not.toHaveBeenCalled()
  })

  it("returns the item's row for the client", async () => {
    m.recommend.mockResolvedValue([{ itemId: 9, vendorName: "V", vendorId: 1, vendorProductId: 2 }])
    const { result } = renderQueryHook(() => useLineRecommendation(9, 3))
    await until(() => expect(result.current.data?.vendorName).toBe("V"))
    expect(m.recommend).toHaveBeenCalledWith([9], 3)
  })

  it("is empty when the item has no row", async () => {
    m.recommend.mockResolvedValue([])
    const { result } = renderQueryHook(() => useLineRecommendation(9))
    await until(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toBeNull()
  })
})
