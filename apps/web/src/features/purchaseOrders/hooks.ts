import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import * as poApi from "@/features/purchaseOrders/api"
import { errorMessage } from "@/lib/errors"
import { queryKeys } from "@/lib/query-keys"
import { uploadToPresignedUrl } from "@/lib/storage-upload"
import { toast } from "@/lib/toast"
import { validateAsset } from "@/lib/upload-validation"
import type { PoBackendStatus, PoUpdateItemsInput } from "@/types/api"

export function usePurchaseOrders(params: poApi.ListParams = {}) {
  return useQuery({
    queryKey: queryKeys.purchaseOrders.list(params),
    queryFn: () => poApi.list(params),
    placeholderData: keepPreviousData,
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
    mutationFn: ({ id, status }: { id: number; status: PoBackendStatus }) =>
      poApi.changeStatus(id, status),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.purchaseOrders.all })
      qc.invalidateQueries({ queryKey: queryKeys.invoices.all })
    },
    onError: (err) => toast.error(errorMessage(err, "Gagal mengubah status PO.")),
  })
}

// Full presigned upload flow.
export function useUploadPoFile() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, file }: { id: number; file: File }) => {
      validateAsset("poDoc", file)
      const presign = await poApi.presignUpload(id, file.name)
      await uploadToPresignedUrl(presign.uploadUrl, file)
      await poApi.updateFile(id, {
        fileName: file.name,
        fileSize: file.size,
        objectKey: presign.objectKey,
      })
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.purchaseOrders.all }),
    onError: (err) => toast.error(errorMessage(err, "Gagal mengunggah file PO.")),
  })
}

export function useUpdatePoItems() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      input,
      rowVersion,
    }: {
      id: number
      input: PoUpdateItemsInput
      rowVersion: number
    }) => poApi.updateItems(id, input, rowVersion),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: queryKeys.purchaseOrders.all })
      qc.invalidateQueries({ queryKey: queryKeys.purchaseOrders.detail(id) })
      qc.invalidateQueries({ queryKey: queryKeys.purchaseOrders.items(id) })
    },
    onError: (err) => toast.error(errorMessage(err, "Gagal memperbarui item PO.")),
  })
}
