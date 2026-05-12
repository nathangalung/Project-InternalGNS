import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import * as invApi from "@/features/invoices/api"
import { queryKeys } from "@/lib/query-keys"
import { uploadToPresignedUrl } from "@/lib/storage-upload"
import type { InvoiceBackendStatus } from "@/types/api"

export function useInvoices(params: invApi.ListParams = {}) {
  return useQuery({
    queryKey: queryKeys.invoices.list(params),
    queryFn: () => invApi.list(params),
    placeholderData: keepPreviousData,
  })
}

export function useInvoiceSummary() {
  return useQuery({
    queryKey: queryKeys.invoices.summary(),
    queryFn: () => invApi.summary(),
  })
}

export function useInvoiceItems(id: number | undefined) {
  return useQuery({
    queryKey: id ? queryKeys.invoices.items(id) : queryKeys.invoices.all,
    queryFn: () => invApi.listItems(id as number),
    enabled: id !== undefined && id > 0,
  })
}

export function useInvoiceByQuotation(quotationId: number | undefined) {
  return useQuery({
    queryKey: quotationId ? queryKeys.invoices.byQuotation(quotationId) : queryKeys.invoices.all,
    queryFn: () => invApi.getByQuotation(quotationId as number),
    enabled: quotationId !== undefined && quotationId > 0,
  })
}

export function useChangeInvoiceStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, status }: { id: number; status: InvoiceBackendStatus }) =>
      invApi.changeStatus(id, status),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.invoices.all }),
  })
}

export function useUploadInvoiceAttachment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, file }: { id: number; file: File }) => {
      const presign = await invApi.presignAttachmentUpload(id, file.name)
      await uploadToPresignedUrl(presign.uploadUrl, file)
      await invApi.updateAttachment(id, presign.objectKey)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.invoices.all }),
  })
}

export function useInvoiceAttachmentDownloadUrl(id: number | undefined, objectKey?: string) {
  return useQuery({
    queryKey: id
      ? [...queryKeys.invoices.list({}), id, "attachment-url", objectKey]
      : queryKeys.invoices.all,
    queryFn: () => invApi.presignAttachmentDownload(id as number),
    enabled: id !== undefined && id > 0 && Boolean(objectKey),
    staleTime: 4 * 60 * 1000,
  })
}
