import {
  keepPreviousData,
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import * as invApi from "@/features/invoices/api"
import { ApiError } from "@/lib/api-client"
import { errorMessage } from "@/lib/errors"
import { queryKeys } from "@/lib/query-keys"
import { uploadWithFreshKey } from "@/lib/storage-upload"
import { toast } from "@/lib/toast"
import { validateAsset } from "@/lib/upload-validation"
import { failureMessage } from "./download"
import type { InvoiceDetail, UpdateInvoiceDatesInput } from "./types"

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

// One invoice by its own id.
export function useInvoice(id: number | undefined) {
  return useQuery({
    queryKey: id ? queryKeys.invoices.detail(id) : queryKeys.invoices.all,
    queryFn: id !== undefined && id > 0 ? () => invApi.getById(id) : skipToken,
  })
}

// Refresh every invoice view.
function useInvalidateInvoices() {
  const qc = useQueryClient()
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: queryKeys.invoices.all }),
      qc.invalidateQueries({ queryKey: queryKeys.dashboard.all }),
    ])
}

// Validated proof upload.
async function uploadPaymentProof(id: number, file: File): Promise<string> {
  validateAsset("invoiceAttachment", file)
  return uploadWithFreshKey(() => invApi.presignPaymentProofUpload(id, file.name), file)
}

// Draft to sent.
export function useSendInvoice() {
  const invalidate = useInvalidateInvoices()
  return useMutation({
    mutationFn: (id: number) => invApi.changeStatus(id, { status: "sent" }),
    onSuccess: async () => {
      await invalidate()
      toast.success("Invoice ditandai Dikirim.")
    },
    onError: (err) => toast.error(errorMessage(err, "Gagal mengubah status invoice.")),
  })
}

// Sent or overdue to paid.
export function useMarkInvoicePaid() {
  const invalidate = useInvalidateInvoices()
  return useMutation({
    mutationFn: async ({ id, proof }: { id: number; proof?: File }) => {
      const paymentProofKey = proof ? await uploadPaymentProof(id, proof) : undefined
      await invApi.changeStatus(id, { status: "paid", paymentProofKey })
    },
    onSuccess: async () => {
      await invalidate()
      toast.success("Invoice ditandai Dibayar.")
    },
    onError: (err) => toast.error(failureMessage(err, "Gagal menandai invoice dibayar.")),
  })
}

// Cancel, then issue the Pengganti.
//
// Two calls, not one transaction. When the second fails the invoice stays
// cancelled with canReplace set, and the page offers Terbitkan Pengganti.
export function useCancelAndReplaceInvoice() {
  const qc = useQueryClient()
  const invalidate = useInvalidateInvoices()
  return useMutation({
    mutationFn: async ({ id, note }: { id: number; note: string }): Promise<InvoiceDetail> => {
      await invApi.changeStatus(id, { status: "cancelled", note })
      return invApi.replace(id)
    },
    onSuccess: async (next) => {
      qc.setQueryData(queryKeys.invoices.byQuotation(next.quotationId), next)
      await invalidate()
      toast.success(`Invoice pengganti ${next.invoiceNo} diterbitkan.`)
    },
    onError: async (err) => {
      await invalidate()
      toast.error(errorMessage(err, "Gagal membatalkan invoice."))
    },
  })
}

// Pengganti for an already cancelled invoice.
export function useReplaceInvoice() {
  const qc = useQueryClient()
  const invalidate = useInvalidateInvoices()
  return useMutation({
    mutationFn: (id: number) => invApi.replace(id),
    onSuccess: async (next) => {
      qc.setQueryData(queryKeys.invoices.byQuotation(next.quotationId), next)
      await invalidate()
      toast.success(`Invoice pengganti ${next.invoiceNo} diterbitkan.`)
    },
    onError: (err) => toast.error(errorMessage(err, "Gagal menerbitkan invoice pengganti.")),
  })
}

export function useUpdateInvoiceDates() {
  const invalidate = useInvalidateInvoices()
  return useMutation({
    mutationFn: ({
      id,
      input,
      rowVersion,
    }: {
      id: number
      input: UpdateInvoiceDatesInput
      rowVersion: number
    }) => invApi.updateDates(id, input, rowVersion),
    onSuccess: async () => {
      await invalidate()
      toast.success("Tanggal invoice disimpan.")
    },
    onError: async (err) => {
      // The 409 detail is English; the page reloads the newer row.
      if (err instanceof ApiError && err.status === 409) {
        await invalidate()
        toast.error(
          "Invoice ini baru saja diubah di tempat lain. Periksa tanggalnya lalu simpan lagi.",
        )
        return
      }
      toast.error(errorMessage(err, "Gagal menyimpan tanggal invoice."))
    },
  })
}

export function useUploadInvoiceAttachment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, file }: { id: number; file: File }) => {
      validateAsset("invoiceAttachment", file)
      const objectKey = await uploadWithFreshKey(
        () => invApi.presignAttachmentUpload(id, file.name),
        file,
      )
      await invApi.updateAttachment(id, objectKey)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.invoices.all }),
    onError: (err) => toast.error(failureMessage(err, "Gagal mengunggah lampiran.")),
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
