import { useQuery } from "@tanstack/react-query"
import { useCallback, useSyncExternalStore } from "react"
import * as auth from "@/features/auth/api"
import { clearTokens, getRefreshToken, setOnAuthExpired, setTokens } from "@/lib/api-client"
import { queryKeys } from "@/lib/query-keys"

const AUTH_KEY = "gns_auth"
const EVENT_NAME = "gns:auth-change"

function read(): boolean {
  return sessionStorage.getItem(AUTH_KEY) === "true"
}

function subscribe(listener: () => void): () => void {
  const handler = () => listener()
  window.addEventListener("storage", handler)
  window.addEventListener(EVENT_NAME, handler)
  return () => {
    window.removeEventListener("storage", handler)
    window.removeEventListener(EVENT_NAME, handler)
  }
}

type Tokens = { token: string; refreshToken?: string }

export function useAuth() {
  const isAuthenticated = useSyncExternalStore(subscribe, read, () => false)

  const login = useCallback((tokens: Tokens) => {
    sessionStorage.setItem(AUTH_KEY, "true")
    setTokens(tokens)
    window.dispatchEvent(new Event(EVENT_NAME))
  }, [])

  const logout = useCallback(() => {
    // Fire-and-forget server revoke. We don't block on it: if the network is
    // down or the token is already revoked, local state still clears.
    if (getRefreshToken()) {
      void auth.logout().catch(() => {})
    }
    sessionStorage.removeItem(AUTH_KEY)
    clearTokens()
    window.dispatchEvent(new Event(EVENT_NAME))
  }, [])

  return { isAuthenticated, login, logout }
}

export function isAuthenticatedSync(): boolean {
  return read()
}

export function clearAuthState(): void {
  sessionStorage.removeItem(AUTH_KEY)
  clearTokens()
  window.dispatchEvent(new Event(EVENT_NAME))
}

// Expired session drops auth state immediately.
setOnAuthExpired(clearAuthState)

export function useMe() {
  return useQuery({
    queryKey: queryKeys.auth.me(),
    queryFn: auth.me,
    staleTime: 5 * 60 * 1000,
    enabled: read(),
  })
}
