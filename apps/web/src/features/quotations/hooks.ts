import {
  keepPreviousData,
  type QueryClient,
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import * as quotationsApi from "@/features/quotations/api"
import { statusChangeToast } from "@/features/quotations/status"
import { errorMessage } from "@/lib/errors"
import { queryKeys } from "@/lib/query-keys"
import { toast } from "@/lib/toast"
import type {
  QuotationItemRequestCreateInput,
  QuotationItemRequestUpdateInput,
  QuotationListParams,
  QuotationStatus,
} from "@/types/api"

// Caches a quotation write touches.
//
// Client and vendor pages show quotation counts.
function invalidateQuotationDeps(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: queryKeys.quotations.all })
  qc.invalidateQueries({ queryKey: queryKeys.dashboard.all })
  qc.invalidateQueries({ queryKey: queryKeys.clients.all })
  qc.invalidateQueries({ queryKey: queryKeys.vendors.all })
}

export function useQuotations(params: QuotationListParams = {}) {
  return useQuery({
    queryKey: queryKeys.quotations.list(params as Record<string, unknown>),
    queryFn: () => quotationsApi.list(params),
    placeholderData: keepPreviousData,
  })
}

export function useQuotation(id: number | undefined) {
  return useQuery({
    queryKey: id ? queryKeys.quotations.detail(id) : queryKeys.quotations.all,
    queryFn: id !== undefined && id > 0 ? () => quotationsApi.get(id) : skipToken,
  })
}

export function useQuotationStats() {
  return useQuery({
    queryKey: queryKeys.quotations.stats(),
    queryFn: quotationsApi.stats,
  })
}

export function useCreateQuotation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: quotationsApi.create,
    onSuccess: () => invalidateQuotationDeps(qc),
    onError: (err) => toast.error(errorMessage(err, "Gagal menyimpan quotation.")),
  })
}

export function useUpdateQuotation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      input,
      rowVersion,
    }: {
      id: number
      input: Parameters<typeof quotationsApi.update>[1]
      rowVersion: number
    }) => quotationsApi.update(id, input, rowVersion),
    onSuccess: () => invalidateQuotationDeps(qc),
    onError: (err) => toast.error(errorMessage(err, "Gagal memperbarui quotation.")),
  })
}

export function useChangeQuotationStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, status, note }: { id: number; status: QuotationStatus; note?: string }) =>
      status === "sent"
        ? quotationsApi.send(id, note)
        : quotationsApi.changeStatus(id, status, note),
    onSuccess: () => {
      invalidateQuotationDeps(qc)
      // Accepting creates a PO.
      qc.invalidateQueries({ queryKey: queryKeys.purchaseOrders.all })
    },
    onError: (err) => {
      const msg = statusChangeToast(err)
      if (msg) toast.error(msg)
    },
  })
}

// Buat Revisi mutation.
export function useReviseQuotation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, note }: { id: number; note?: string }) => quotationsApi.revise(id, note),
    onSuccess: () => invalidateQuotationDeps(qc),
    onError: (err) => toast.error(errorMessage(err, "Gagal membuat revisi quotation.")),
  })
}

export function useUpdateQuotationContact() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, contactId }: { id: number; contactId: number }) =>
      quotationsApi.updateQuotationContact(id, contactId),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: queryKeys.quotations.detail(id) })
    },
    onError: (err) => toast.error(errorMessage(err, "Gagal mengubah narahubung quotation.")),
  })
}

export function useQuotationRevisions(id: number | undefined) {
  return useQuery({
    queryKey: id ? queryKeys.quotations.revisions(id) : queryKeys.quotations.all,
    queryFn: id !== undefined && id > 0 ? () => quotationsApi.listRevisions(id) : skipToken,
  })
}

export function useQuotationRequests(quotationId: number | undefined) {
  return useQuery({
    queryKey: quotationId ? queryKeys.quotations.requests(quotationId) : queryKeys.quotations.all,
    queryFn:
      quotationId !== undefined && quotationId > 0
        ? () => quotationsApi.listRequests(quotationId)
        : skipToken,
  })
}

type UpsertArgs =
  | { quotationId: number; requestId?: undefined; input: QuotationItemRequestCreateInput }
  | { quotationId: number; requestId: number; input: QuotationItemRequestUpdateInput }

export function useUpsertQuotationRequest() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (args: UpsertArgs) => {
      if (args.requestId === undefined) {
        return quotationsApi.createRequest(args.quotationId, args.input)
      }
      return quotationsApi.updateRequest(args.quotationId, args.requestId, args.input)
    },
    onSuccess: (_, { quotationId }) => {
      qc.invalidateQueries({ queryKey: queryKeys.quotations.requests(quotationId) })
    },
    onError: (err) => toast.error(errorMessage(err, "Gagal menyimpan item request.")),
  })
}

export function useDeleteQuotationRequest() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ quotationId, requestId }: { quotationId: number; requestId: number }) =>
      quotationsApi.deleteRequest(quotationId, requestId),
    onSuccess: (_, { quotationId }) => {
      qc.invalidateQueries({ queryKey: queryKeys.quotations.requests(quotationId) })
    },
    onError: (err) => toast.error(errorMessage(err, "Gagal menghapus item request.")),
  })
}

// PDF download, Indonesian toast.
export async function downloadQuotationPdf(id: number, quotationNo: string): Promise<void> {
  try {
    await quotationsApi.downloadPdfFile(id, quotationNo)
  } catch {
    toast.error("Gagal mengunduh PDF quotation. Coba lagi.")
  }
}

// XLSX export, Indonesian toast.
export async function exportQuotationsXlsx(params: QuotationListParams): Promise<void> {
  try {
    await quotationsApi.exportXlsx(params)
  } catch {
    toast.error("Gagal mengekspor daftar quotation. Coba lagi.")
  }
}
