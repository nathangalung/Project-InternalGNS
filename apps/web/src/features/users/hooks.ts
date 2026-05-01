import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import * as usersApi from "@/features/users/api"
import { queryKeys } from "@/lib/query-keys"

export function useUsers(params: { limit?: number; offset?: number } = {}) {
  return useQuery({
    queryKey: queryKeys.users.list(params),
    queryFn: () => usersApi.list(params),
  })
}

export function useCreateUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: usersApi.create,
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.users.all }),
  })
}

export function useUser(id: number | undefined) {
  return useQuery({
    queryKey: id ? queryKeys.users.detail(id) : queryKeys.users.all,
    queryFn: () => usersApi.get(id as number),
    enabled: id !== undefined && id > 0,
  })
}

export function useUpdateUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: usersApi.UpdateUserInput }) =>
      usersApi.update(id, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.users.all }),
  })
}
