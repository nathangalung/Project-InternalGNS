import { act } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { apiRequest, getRefreshToken } from "@/lib/api-client"
import { queryClient } from "@/lib/query-client"
import { renderQueryHook, until } from "@/test/query"
import { renderHook } from "@/test/renderHook"
import * as api from "./api"
import { clearAuthState, isAuthenticatedSync, useAuth, useMe } from "./hooks"

vi.mock("./api")

const m = vi.mocked(api)

beforeEach(() => {
  vi.clearAllMocks()
  sessionStorage.clear()
  queryClient.clear()
})
afterEach(() => vi.unstubAllGlobals())

describe("useAuth", () => {
  it("starts signed out", () => {
    const { result } = renderHook(() => useAuth(), undefined)
    expect(result.current.isAuthenticated).toBe(false)
    expect(isAuthenticatedSync()).toBe(false)
  })

  it("signs in: stores the tokens and re-renders", () => {
    const { result } = renderHook(() => useAuth(), undefined)
    act(() => result.current.login({ token: "t", refreshToken: "r" }))
    expect(result.current.isAuthenticated).toBe(true)
    expect(isAuthenticatedSync()).toBe(true)
    expect(sessionStorage.getItem("gns_token")).toBe("t")
    expect(getRefreshToken()).toBe("r")
  })

  it("signs out: revokes on the server, clears tokens and the previous user's cache", () => {
    m.logout.mockResolvedValue(undefined)
    const { result } = renderHook(() => useAuth(), undefined)
    act(() => result.current.login({ token: "t", refreshToken: "r" }))
    queryClient.setQueryData(["invoices", "list", {}], { rows: [1] })
    act(() => result.current.logout())
    expect(m.logout).toHaveBeenCalledTimes(1)
    expect(result.current.isAuthenticated).toBe(false)
    expect(sessionStorage.getItem("gns_token")).toBeNull()
    expect(getRefreshToken()).toBeNull()
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0)
  })

  it("still signs out locally when the server revoke fails", async () => {
    m.logout.mockRejectedValue(new TypeError("Failed to fetch"))
    const { result } = renderHook(() => useAuth(), undefined)
    act(() => result.current.login({ token: "t", refreshToken: "r" }))
    await act(async () => result.current.logout())
    expect(result.current.isAuthenticated).toBe(false)
  })

  it("skips the server revoke without a refresh token", () => {
    const { result } = renderHook(() => useAuth(), undefined)
    act(() => result.current.login({ token: "t" }))
    act(() => result.current.logout())
    expect(m.logout).not.toHaveBeenCalled()
    expect(result.current.isAuthenticated).toBe(false)
  })

  it("follows a sign-out from another tab", () => {
    const { result } = renderHook(() => useAuth(), undefined)
    act(() => result.current.login({ token: "t" }))
    act(() => {
      sessionStorage.removeItem("gns_auth")
      window.dispatchEvent(new Event("storage"))
    })
    expect(result.current.isAuthenticated).toBe(false)
  })

  it("stops listening once unmounted", () => {
    const remove = vi.spyOn(window, "removeEventListener")
    const { unmount } = renderHook(() => useAuth(), undefined)
    unmount()
    const events = remove.mock.calls.map(([name]) => name)
    expect(events).toEqual(expect.arrayContaining(["storage", "gns:auth-change"]))
    remove.mockRestore()
  })

  it("clearAuthState signs every mounted hook out", () => {
    const { result } = renderHook(() => useAuth(), undefined)
    act(() => result.current.login({ token: "t" }))
    act(() => clearAuthState())
    expect(result.current.isAuthenticated).toBe(false)
  })
})

describe("expired session", () => {
  it("drops auth state when the refresh cannot renew the session", async () => {
    const { result } = renderHook(() => useAuth(), undefined)
    act(() => result.current.login({ token: "t" }))
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 401 })),
    )
    await act(async () => {
      await apiRequest({ path: "/users" }).catch(() => {})
    })
    expect(result.current.isAuthenticated).toBe(false)
    expect(sessionStorage.getItem("gns_token")).toBeNull()
  })
})

describe("useMe", () => {
  it("does not ask who is signed in while signed out", async () => {
    const { result } = renderQueryHook(() => useMe())
    await until(() => expect(result.current.fetchStatus).toBe("idle"))
    expect(m.me).not.toHaveBeenCalled()
  })

  it("loads the signed-in user", async () => {
    sessionStorage.setItem("gns_auth", "true")
    m.me.mockResolvedValue({ id: 1, email: "a@gns.id", name: "Ani", role: "finance" })
    const { result } = renderQueryHook(() => useMe())
    await until(() => expect(result.current.data?.role).toBe("finance"))
  })
})
