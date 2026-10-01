import {
  keepPreviousData,
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import * as itemsApi from "@/features/items/api"
import * as vendorsApi from "@/features/vendors/api"
import { useObjectUrl } from "@/hooks/useObjectUrl"
import { errorMessage } from "@/lib/errors"
import { shrinkImage } from "@/lib/image-shrink"
import { queryKeys } from "@/lib/query-keys"
import { uploadWithFreshKey } from "@/lib/storage-upload"
import { toast } from "@/lib/toast"
import { validateAsset } from "@/lib/upload-validation"

export function useItems(
  params: itemsApi.ItemListParams = {},
  options: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: queryKeys.items.list(params),
    queryFn: () => itemsApi.list(params),
    enabled: options.enabled ?? true,
    placeholderData: keepPreviousData,
  })
}

export function useItem(id: number | undefined) {
  return useQuery({
    queryKey: id ? queryKeys.items.detail(id) : queryKeys.items.all,
    queryFn: id !== undefined && id > 0 ? () => itemsApi.get(id) : skipToken,
  })
}

// Multi-source advanced search.
//
// keepPreviousData prevents UI flicker while the user types (per TanStack
// Query v5 paginated-queries guidance).
export function useItemSearchAdvanced(q: string, options: itemsApi.SearchAdvancedOptions = {}) {
  return useQuery({
    queryKey: [
      ...queryKeys.items.searchAdvanced(q, options.minScore, options.limit, options.isActive),
      options.offset ?? 0,
    ],
    queryFn: () => itemsApi.searchAdvanced(q, options),
    enabled: q.trim().length > 0,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  })
}

export function useItemVendors(itemId: number | undefined) {
  return useQuery({
    queryKey: itemId ? queryKeys.items.vendors(itemId) : queryKeys.items.all,
    queryFn: itemId !== undefined && itemId > 0 ? () => itemsApi.listVendors(itemId) : skipToken,
  })
}

// Active vendors matching q.
//
// Searches on the server so every vendor is reachable, not just the first
// page. Inactive vendors are left out because the API refuses to link them.
export function useActiveVendorOptions(q: string, limit = 10) {
  const term = q.trim()
  const params: vendorsApi.VendorListParams = { q: term, isActive: true, limit }
  return useQuery({
    queryKey: queryKeys.vendors.list(params),
    queryFn: () => vendorsApi.list(params),
    enabled: term.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  })
}

export function useItemPriceHistory(itemId: number | undefined, limit?: number) {
  return useQuery({
    queryKey: itemId ? queryKeys.items.priceHistory(itemId, limit) : queryKeys.items.all,
    queryFn:
      itemId !== undefined && itemId > 0
        ? () => itemsApi.priceHistory(itemId, { limit })
        : skipToken,
  })
}

export function useCreateItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: itemsApi.create,
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.items.all }),
  })
}

export function useUpdateItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: itemsApi.UpdateItemInput }) =>
      itemsApi.update(id, input),
    // Vendor tabs show item names.
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.items.all })
      qc.invalidateQueries({ queryKey: queryKeys.vendors.all })
    },
    onError: (err) => toast.error(errorMessage(err, "Gagal memperbarui produk.")),
  })
}

export function useAddVendorToItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ itemId, input }: { itemId: number; input: itemsApi.AddVendorToItemInput }) =>
      itemsApi.addVendor(itemId, input),
    // Vendor detail, counts change too.
    onSuccess: (_data, { itemId }) => {
      qc.invalidateQueries({ queryKey: queryKeys.items.vendors(itemId) })
      qc.invalidateQueries({ queryKey: queryKeys.vendors.all })
    },
  })
}

export function useUploadItemImage() {
  const qc = useQueryClient()
  return useMutation({
    // Shrink first, so a large phone photo that fits once shrunk is let in.
    mutationFn: async ({ id, file }: { id: number; file: File }) => {
      const ready = await shrinkImage(file)
      validateAsset("itemImage", ready)
      const objectKey = await uploadWithFreshKey(
        () => itemsApi.presignImageUpload(id, ready.name),
        ready,
      )
      await itemsApi.updateImage(id, objectKey)
    },
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: queryKeys.items.detail(id) })
      qc.invalidateQueries({ queryKey: queryKeys.items.all })
    },
    onError: (err) => toast.error(errorMessage(err, "Gagal mengunggah foto produk.")),
  })
}

export function useItemImageDownloadUrl(id: number | undefined, objectKey?: string) {
  return useQuery({
    queryKey: id ? [...queryKeys.items.detail(id), "image-url", objectKey] : queryKeys.items.all,
    queryFn:
      id !== undefined && id > 0 && objectKey ? () => itemsApi.presignImageDownload(id) : skipToken,
    staleTime: 4 * 60 * 1000,
  })
}

export function useRemoveItemImage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => itemsApi.removeImage(id),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: queryKeys.items.detail(id) })
      qc.invalidateQueries({ queryKey: queryKeys.items.all })
    },
    onError: (err) => toast.error(errorMessage(err, "Gagal menghapus foto produk.")),
  })
}

// Product image as a blob URL.
// Empty while loading or when the product has none.
export function useItemImage(id: number, objectKey: string | undefined): string {
  const { data } = useItemImageDownloadUrl(id, objectKey)
  return useObjectUrl(objectKey ? data?.downloadUrl : undefined)
}
