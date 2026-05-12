import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import * as itemsApi from "@/features/items/api"
import { queryKeys } from "@/lib/query-keys"

export function useItems(params: itemsApi.ItemListParams = {}) {
  return useQuery({
    queryKey: queryKeys.items.list(params),
    queryFn: () => itemsApi.list(params),
    placeholderData: keepPreviousData,
  })
}

export function useItem(id: number | undefined) {
  return useQuery({
    queryKey: id ? queryKeys.items.detail(id) : queryKeys.items.all,
    queryFn: () => itemsApi.get(id as number),
    enabled: id !== undefined && id > 0,
  })
}

export function useItemSearch(q: string, options: { minScore?: number; limit?: number } = {}) {
  return useQuery({
    queryKey: queryKeys.items.search(q),
    queryFn: () => itemsApi.search(q, options),
    enabled: q.trim().length > 0,
  })
}

// Multi-source advanced search. keepPreviousData prevents UI flicker
// while user types (per TanStack Query v5 paginated-queries guidance).
export function useItemSearchAdvanced(
  q: string,
  options: { minScore?: number; limit?: number } = {},
) {
  return useQuery({
    queryKey: queryKeys.items.searchAdvanced(q, options.minScore, options.limit),
    queryFn: () => itemsApi.searchAdvanced(q, options),
    enabled: q.trim().length > 0,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  })
}

export function useItemVendors(itemId: number | undefined) {
  return useQuery({
    queryKey: itemId ? queryKeys.items.vendors(itemId) : queryKeys.items.all,
    queryFn: () => itemsApi.listVendors(itemId as number),
    enabled: itemId !== undefined && itemId > 0,
  })
}

export function useItemPriceHistory(itemId: number | undefined, limit?: number) {
  return useQuery({
    queryKey: itemId ? queryKeys.items.priceHistory(itemId, limit) : queryKeys.items.all,
    queryFn: () => itemsApi.priceHistory(itemId as number, { limit }),
    enabled: itemId !== undefined && itemId > 0,
  })
}

export function useMatchRequest() {
  return useMutation({
    mutationFn: ({ reqText, limit }: { reqText: string; limit?: number }) =>
      itemsApi.matchRequest(reqText, limit),
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
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.items.all }),
  })
}

export function useAddVendorToItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ itemId, input }: { itemId: number; input: itemsApi.AddVendorToItemInput }) =>
      itemsApi.addVendor(itemId, input),
    onSuccess: (_data, { itemId }) =>
      qc.invalidateQueries({ queryKey: queryKeys.items.vendors(itemId) }),
  })
}
