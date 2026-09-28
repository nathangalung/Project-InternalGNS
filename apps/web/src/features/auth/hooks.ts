import { useQuery } from "@tanstack/react-query"
import { useCallback, useSyncExternalStore } from "react"
import * as auth from "@/features/auth/api"
import { queryClient } from "@/lib/query-client"
import { queryKeys } from "@/lib/query-keys"
import { endSession, isSignedIn, signIn, signOut, subscribeSession } from "@/lib/session"

export function useAuth() {
  const isAuthenticated = useSyncExternalStore(subscribeSession, isSignedIn, () => false)

  const login = useCallback((token: string) => signIn(token), [])

  // Local state clears at once; the server revoke runs behind any refresh.
  const logout = useCallback(() => {
    void signOut()
  }, [])

  return { isAuthenticated, login, logout }
}

export function isAuthenticatedSync(): boolean {
  return isSignedIn()
}

// Local sign-out, server untouched.
export function clearAuthState(): void {
  endSession()
}

// A signed-out tab keeps no data.
//
// Whatever ended the session (logout, expiry, another tab), the previous
// user's cache goes with it so the next login never renders it.
subscribeSession(() => {
  if (!isSignedIn()) queryClient.clear()
})

export function useMe() {
  return useQuery({
    queryKey: queryKeys.auth.me(),
    queryFn: auth.me,
    staleTime: 5 * 60 * 1000,
    enabled: isSignedIn(),
  })
}
