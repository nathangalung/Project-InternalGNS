import {
  keepPreviousData,
  type QueryClient,
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { useCallback } from "react"
import { changeOwnPassword } from "@/features/auth/api"
import { clearAuthState } from "@/features/auth/hooks"
import * as usersApi from "@/features/users/api"
import { isInlineFormError } from "@/features/users/form-errors"
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
    // Field and conflict errors render inline.
    onError: (err) => {
      if (!isInlineFormError(err)) toast.error(errorMessage(err, "Gagal menyimpan pengguna."))
    },
  })
}

export function useUser(id: number | undefined) {
  return useQuery({
    queryKey: id ? queryKeys.users.detail(id) : queryKeys.users.all,
    queryFn: id !== undefined && id > 0 ? () => usersApi.get(id) : skipToken,
  })
}

type UpdateUserVars = {
  id: number
  input: usersApi.UpdateUserInput
  // Caller's own role or access changes.
  endsOwnSession?: boolean
}

export function useUpdateUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: UpdateUserVars) => usersApi.update(id, input),
    // A self-edit that ends the session skips the refetch; the caller logs out.
    onSuccess: (_user, { endsOwnSession }) =>
      endsOwnSession ? undefined : refreshAfterUserEdit(qc),
    onError: (err) => {
      if (err instanceof usersApi.PartialUserUpdateError) {
        // Profile persisted, so refresh the cache anyway.
        void refreshAfterUserEdit(qc)
        return
      }
      if (!isInlineFormError(err)) toast.error(errorMessage(err, "Gagal memperbarui pengguna."))
    },
  })
}

// Self-service password change.
//
// No cache work here: success ends the session, and the caller clears the
// auth state, which also empties the query cache.
export function useChangeOwnPassword() {
  return useMutation({ mutationFn: changeOwnPassword })
}

// Sign out with a notice.
//
// Clears tokens and the query cache locally without POSTing /auth/logout,
// since the server has already revoked every session and the call would only
// trip the refresh cycle.
export function useEndOwnSession() {
  const navigate = useNavigate()
  return useCallback(
    (message: string, tone: "success" | "info" | "error" = "info") => {
      clearAuthState()
      toast[tone](message)
      void navigate({ to: "/login" })
    },
    [navigate],
  )
}
