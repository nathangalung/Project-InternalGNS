import {
  keepPreviousData,
  type QueryClient,
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import * as usersApi from "@/features/users/api"
import { errorMessage } from "@/lib/errors"
import { queryKeys } from "@/lib/query-keys"
import { toast } from "@/lib/toast"

// Users plus me, for self-edits.
//
// Editing your own name or role must reach the sidebar and route guards,
// which read the cached me query.
function refreshAfterUserEdit(qc: QueryClient) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: queryKeys.users.all }),
    qc.invalidateQueries({ queryKey: queryKeys.auth.me() }),
  ])
}

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
    onError: (err) => toast.error(errorMessage(err, "Gagal menyimpan pengguna.")),
  })
}

export function useUser(id: number | undefined) {
  return useQuery({
    queryKey: id ? queryKeys.users.detail(id) : queryKeys.users.all,
    queryFn: id !== undefined && id > 0 ? () => usersApi.get(id) : skipToken,
  })
}

export function useUpdateUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: usersApi.UpdateUserInput }) =>
      usersApi.update(id, input),
    onSuccess: () => refreshAfterUserEdit(qc),
    onError: (err) => {
      if (err instanceof usersApi.PartialUserUpdateError) {
        // Profile persisted, so refresh the cache anyway.
        void refreshAfterUserEdit(qc)
        toast.error("Profil tersimpan, tetapi kata sandi gagal diperbarui.")
        return
      }
      toast.error(errorMessage(err, "Gagal memperbarui pengguna."))
    },
  })
}
