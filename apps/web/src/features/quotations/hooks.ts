import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import * as quotationsApi from "@/features/quotations/api"
import { queryKeys } from "@/lib/query-keys"
import type {
  CanonicalStatus,
  QuotationItemRequestCreateInput,
  QuotationItemRequestUpdateInput,
  QuotationListParams,
} from "@/types/api"

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
    queryFn: () => quotationsApi.get(id as number),
    enabled: id !== undefined && id > 0,
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
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.quotations.all }),
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
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: queryKeys.quotations.detail(id) })
      qc.invalidateQueries({ queryKey: queryKeys.quotations.all })
    },
  })
}

export function useChangeQuotationStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, status, note }: { id: number; status: CanonicalStatus; note?: string }) =>
      quotationsApi.changeStatus(id, status, note),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: queryKeys.quotations.detail(id) })
      qc.invalidateQueries({ queryKey: queryKeys.quotations.all })
      qc.invalidateQueries({ queryKey: queryKeys.quotations.stats() })
    },
  })
}

export function useQuotationRevisions(id: number | undefined) {
  return useQuery({
    queryKey: id ? queryKeys.quotations.revisions(id) : queryKeys.quotations.all,
    queryFn: () => quotationsApi.listRevisions(id as number),
    enabled: id !== undefined && id > 0,
  })
}

export function useQuotationRequests(quotationId: number | undefined) {
  return useQuery({
    queryKey: quotationId ? queryKeys.quotations.requests(quotationId) : queryKeys.quotations.all,
    queryFn: () => quotationsApi.listRequests(quotationId as number),
    enabled: quotationId !== undefined && quotationId > 0,
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
  })
}
