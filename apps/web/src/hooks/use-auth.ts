import { useCallback, useSyncExternalStore } from "react"

const AUTH_KEY = "gns_auth"
const TOKEN_KEY = "gns_token"
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

export function useAuth() {
  const isAuthenticated = useSyncExternalStore(subscribe, read, () => false)

  const login = useCallback((token?: string) => {
    sessionStorage.setItem(AUTH_KEY, "true")
    if (token) sessionStorage.setItem(TOKEN_KEY, token)
    window.dispatchEvent(new Event(EVENT_NAME))
  }, [])

  const logout = useCallback(() => {
    sessionStorage.removeItem(AUTH_KEY)
    sessionStorage.removeItem(TOKEN_KEY)
    window.dispatchEvent(new Event(EVENT_NAME))
  }, [])

  return { isAuthenticated, login, logout }
}

export function isAuthenticatedSync(): boolean {
  return read()
}
