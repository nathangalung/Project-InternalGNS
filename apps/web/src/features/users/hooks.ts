import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import * as usersApi from "@/features/users/api"
import { errorMessage } from "@/lib/errors"
import { queryKeys } from "@/lib/query-keys"
import { toast } from "@/lib/toast"

export function useUsers(params: usersApi.ListParams = {}) {
  return useQuery({
    queryKey: queryKeys.users.list(params),
    queryFn: () => usersApi.list(params),
    placeholderData: keepPreviousData,
  })
}

export function useCreateUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: usersApi.create,
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.users.all }),
    onError: (err) => toast.error(errorMessage(err, "Gagal menyimpan user.")),
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
    onError: (err) => toast.error(errorMessage(err, "Gagal memperbarui user.")),
  })
}
