import {
  keepPreviousData,
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import * as invApi from "@/features/invoices/api"
import { errorMessage } from "@/lib/errors"
import { queryKeys } from "@/lib/query-keys"
import { uploadToPresignedUrl } from "@/lib/storage-upload"
import { toast } from "@/lib/toast"
import { validateAsset } from "@/lib/upload-validation"
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
    queryFn: id !== undefined && id > 0 ? () => invApi.listItems(id) : skipToken,
  })
}

export function useInvoiceByQuotation(quotationId: number | undefined) {
  return useQuery({
    queryKey: quotationId ? queryKeys.invoices.byQuotation(quotationId) : queryKeys.invoices.all,
    queryFn:
      quotationId !== undefined && quotationId > 0
        ? () => invApi.getByQuotation(quotationId)
        : skipToken,
  })
}

export function useChangeInvoiceStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, status }: { id: number; status: InvoiceBackendStatus }) =>
      invApi.changeStatus(id, status),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.invoices.all })
      qc.invalidateQueries({ queryKey: queryKeys.dashboard.all })
    },
    onError: (err) => toast.error(errorMessage(err, "Gagal mengubah status invoice.")),
  })
}

export function useUploadInvoiceAttachment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, file }: { id: number; file: File }) => {
      validateAsset("invoiceAttachment", file)
      const presign = await invApi.presignAttachmentUpload(id, file.name)
      await uploadToPresignedUrl(presign.uploadUrl, file)
      await invApi.updateAttachment(id, presign.objectKey)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.invoices.all }),
    onError: (err) => toast.error(errorMessage(err, "Gagal mengunggah lampiran.")),
  })
}

export function useInvoiceAttachmentDownloadUrl(id: number | undefined, objectKey?: string) {
  return useQuery({
    queryKey: id
      ? [...queryKeys.invoices.detail(id), "attachment-url", objectKey]
      : queryKeys.invoices.all,
    queryFn:
      id !== undefined && id > 0 && objectKey
        ? () => invApi.presignAttachmentDownload(id)
        : skipToken,
    staleTime: 4 * 60 * 1000,
  })
}
