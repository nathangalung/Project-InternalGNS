import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import * as invApi from "@/features/invoices/api"
import { queryKeys } from "@/lib/query-keys"
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
