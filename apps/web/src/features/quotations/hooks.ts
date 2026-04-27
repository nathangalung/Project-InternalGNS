import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as quotationsApi from "@/features/quotations/api";
import type { CanonicalStatus, QuotationListParams } from "@/types/api";
import { queryKeys } from "@/lib/query-keys";

export function useQuotations(params: QuotationListParams = {}) {
  return useQuery({
    queryKey: queryKeys.quotations.list(params as Record<string, unknown>),
    queryFn: () => quotationsApi.list(params),
  });
}

export function useQuotation(id: number | undefined) {
  return useQuery({
    queryKey: id ? queryKeys.quotations.detail(id) : queryKeys.quotations.all,
    queryFn: () => quotationsApi.get(id as number),
    enabled: id !== undefined && id > 0,
  });
}

export function useQuotationStats() {
  return useQuery({
    queryKey: queryKeys.quotations.stats(),
    queryFn: quotationsApi.stats,
  });
}

export function useCreateQuotation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: quotationsApi.create,
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.quotations.all }),
  });
}

export function useUpdateQuotation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: Parameters<typeof quotationsApi.update>[1] }) =>
      quotationsApi.update(id, input),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: queryKeys.quotations.detail(id) });
      qc.invalidateQueries({ queryKey: queryKeys.quotations.all });
    },
  });
}

export function useChangeQuotationStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status, note }: { id: number; status: CanonicalStatus; note?: string }) =>
      quotationsApi.changeStatus(id, status, note),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: queryKeys.quotations.detail(id) });
      qc.invalidateQueries({ queryKey: queryKeys.quotations.all });
      qc.invalidateQueries({ queryKey: queryKeys.quotations.stats() });
    },
  });
}

export function useSendQuotation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => quotationsApi.send(id),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: queryKeys.quotations.detail(id) });
      qc.invalidateQueries({ queryKey: queryKeys.quotations.all });
    },
  });
}
