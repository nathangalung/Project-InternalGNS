import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as vendorsApi from "@/features/vendors/api";
import { queryKeys } from "@/lib/query-keys";

export function useVendors(params: { limit?: number; offset?: number } = {}) {
  return useQuery({
    queryKey: queryKeys.vendors.list(params),
    queryFn: () => vendorsApi.list(params),
  });
}

export function useVendor(id: number | undefined) {
  return useQuery({
    queryKey: id ? queryKeys.vendors.detail(id) : queryKeys.vendors.all,
    queryFn: () => vendorsApi.get(id as number),
    enabled: id !== undefined && id > 0,
  });
}

export function useVendorSearch(q: string, options: { minScore?: number; limit?: number } = {}) {
  return useQuery({
    queryKey: queryKeys.vendors.search(q),
    queryFn: () => vendorsApi.search(q, options),
    enabled: q.trim().length > 0,
  });
}

export function useVendorItems(vendorId: number | undefined) {
  return useQuery({
    queryKey: vendorId ? queryKeys.vendors.items(vendorId) : queryKeys.vendors.all,
    queryFn: () => vendorsApi.listItems(vendorId as number),
    enabled: vendorId !== undefined && vendorId > 0,
  });
}

export function useCreateVendor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: vendorsApi.create,
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.vendors.all }),
  });
}

export function useUpdateVendor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: vendorsApi.UpdateVendorInput }) =>
      vendorsApi.update(id, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.vendors.all }),
  });
}
