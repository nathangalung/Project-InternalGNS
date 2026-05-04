import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import * as invApi from "@/features/invoices/api"
import { queryKeys } from "@/lib/query-keys"

export function useInvoices(params: invApi.ListParams = {}) {
  return useQuery({
    queryKey: queryKeys.invoices.list(params),
    queryFn: () => invApi.list(params),
  })
}

export function useInvoiceSummary() {
  return useQuery({
    queryKey: queryKeys.invoices.summary(),
    queryFn: () => invApi.summary(),
  })
}

export function useInvoice(id: number | undefined) {
  return useQuery({
    queryKey: id ? queryKeys.invoices.detail(id) : queryKeys.invoices.all,
    queryFn: () => invApi.get(id as number),
    enabled: id !== undefined && id > 0,
  })
}

export function useInvoiceByQuotation(quotationId: number | undefined) {
  return useQuery({
    queryKey: quotationId
      ? queryKeys.invoices.byQuotation(quotationId)
      : queryKeys.invoices.all,
    queryFn: () => invApi.getByQuotation(quotationId as number),
    enabled: quotationId !== undefined && quotationId > 0,
  })
}

export function useChangeInvoiceStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      status,
    }: {
      id: number
      status: invApi.ListParams["status"] & string
    }) => invApi.changeStatus(id, status),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.invoices.all }),
  })
}

export function useUpdateInvoiceDates() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: number
      payload: { invoiceDate?: string; dueDate?: string }
    }) => invApi.updateDates(id, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.invoices.all }),
  })
}
