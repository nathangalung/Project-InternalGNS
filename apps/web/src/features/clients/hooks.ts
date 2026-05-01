import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as clientsApi from "@/features/clients/api";
import { queryKeys } from "@/lib/query-keys";

export function useClients(params: { limit?: number; offset?: number } = {}) {
  return useQuery({
    queryKey: queryKeys.clients.list(params),
    queryFn: () => clientsApi.list(params),
  });
}

export function useClient(id: number | undefined) {
  return useQuery({
    queryKey: id ? queryKeys.clients.detail(id) : queryKeys.clients.all,
    queryFn: () => clientsApi.get(id as number),
    enabled: id !== undefined && id > 0,
  });
}

export function useClientSearch(q: string, options: { minScore?: number; limit?: number } = {}) {
  return useQuery({
    queryKey: queryKeys.clients.search(q),
    queryFn: () => clientsApi.search(q, options),
    enabled: q.trim().length > 0,
  });
}

export function useClientContacts(companyId: number | undefined) {
  return useQuery({
    queryKey: companyId ? queryKeys.clients.contacts(companyId) : queryKeys.clients.all,
    queryFn: () => clientsApi.listContacts(companyId as number),
    enabled: companyId !== undefined && companyId > 0,
  });
}

export function useCreateClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: clientsApi.create,
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.clients.all }),
  });
}

export function useUpdateClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: clientsApi.UpdateClientInput }) =>
      clientsApi.update(id, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.clients.all }),
  });
}

export function useCreateContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ companyId, input }: { companyId: number; input: Parameters<typeof clientsApi.createContact>[1] }) =>
      clientsApi.createContact(companyId, input),
    onSuccess: (_, { companyId }) => qc.invalidateQueries({ queryKey: queryKeys.clients.contacts(companyId) }),
  });
}
