import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import * as poApi from "@/features/purchaseOrders/api"
import { queryKeys } from "@/lib/query-keys"

export function usePurchaseOrders(params: poApi.ListParams = {}) {
  return useQuery({
    queryKey: queryKeys.purchaseOrders.list(params),
    queryFn: () => poApi.list(params),
  })
}

export function usePurchaseOrder(id: number | undefined) {
  return useQuery({
    queryKey: id ? queryKeys.purchaseOrders.detail(id) : queryKeys.purchaseOrders.all,
    queryFn: () => poApi.get(id as number),
    enabled: id !== undefined && id > 0,
  })
}

export function usePoItems(id: number | undefined) {
  return useQuery({
    queryKey: id ? queryKeys.purchaseOrders.items(id) : queryKeys.purchaseOrders.all,
    queryFn: () => poApi.listItems(id as number),
    enabled: id !== undefined && id > 0,
  })
}

export function usePurchaseOrderByQuotation(quotationId: number | undefined) {
  return useQuery({
    queryKey: quotationId
      ? queryKeys.purchaseOrders.byQuotation(quotationId)
      : queryKeys.purchaseOrders.all,
    queryFn: () => poApi.getByQuotation(quotationId as number),
    enabled: quotationId !== undefined && quotationId > 0,
  })
}

export function useChangePoStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, status }: { id: number; status: poApi.ListParams["status"] & string }) =>
      poApi.changeStatus(id, status),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.purchaseOrders.all })
      qc.invalidateQueries({ queryKey: queryKeys.invoices.all })
    },
  })
}

export function useUpdatePoFile() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: number
      payload: { fileName: string; fileSize: number; fileUrl: string }
    }) => poApi.updateFile(id, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.purchaseOrders.all }),
  })
}

export function useUpdatePoNotes() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, notes }: { id: number; notes: string }) => poApi.updateNotes(id, notes),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.purchaseOrders.all }),
  })
}
