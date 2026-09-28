import { act } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { apiRequest } from "@/lib/api-client"
import { queryClient } from "@/lib/query-client"
import { endSession, getAccessToken, signIn } from "@/lib/session"
import { renderQueryHook, until } from "@/test/query"
import { renderHook } from "@/test/renderHook"
import { fakeAuthServer, header, installBrowser } from "@/test/tabs"
import * as api from "./api"
import { clearAuthState, isAuthenticatedSync, useAuth, useMe } from "./hooks"

vi.mock("./api")

const m = vi.mocked(api)

beforeEach(() => {
  vi.clearAllMocks()
  installBrowser()
  endSession()
  queryClient.clear()
})
afterEach(() => vi.unstubAllGlobals())

describe("useAuth", () => {
  it("starts signed out", () => {
    const { result } = renderHook(() => useAuth(), undefined)
    expect(result.current.isAuthenticated).toBe(false)
    expect(isAuthenticatedSync()).toBe(false)
  })

  it("signs in: holds the token in memory only and re-renders", () => {
    const { result } = renderHook(() => useAuth(), undefined)
    act(() => result.current.login("t"))
    expect(result.current.isAuthenticated).toBe(true)
    expect(isAuthenticatedSync()).toBe(true)
    expect(getAccessToken()).toBe("t")
    expect(sessionStorage.length).toBe(0)
    expect(localStorage.length).toBe(0)
  })

  it("signs out: revokes the cookie on the server and drops the previous user's cache", async () => {
    const server = fakeAuthServer()
    const { result } = renderHook(() => useAuth(), undefined)
    act(() => result.current.login("t"))
    queryClient.setQueryData(["invoices", "list", {}], { rows: [1] })
    await act(async () => result.current.logout())
    await until(() => expect(server.calls.map((c) => c.path)).toEqual(["/auth/logout"]))
    const [call] = server.calls
    expect(call.init.credentials).toBe("include")
    expect(header(call.init, "X-GNS-CSRF")).toBe("1")
    expect(result.current.isAuthenticated).toBe(false)
    expect(getAccessToken()).toBeNull()
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0)
  })

  it("still signs out locally when the server revoke fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch")
      }),
    )
    const { result } = renderHook(() => useAuth(), undefined)
    act(() => result.current.login("t"))
    await act(async () => result.current.logout())
    expect(result.current.isAuthenticated).toBe(false)
  })

  it("follows a session that ends elsewhere", () => {
    const { result } = renderHook(() => useAuth(), undefined)
    act(() => signIn("t"))
    expect(result.current.isAuthenticated).toBe(true)
    act(() => endSession())
    expect(result.current.isAuthenticated).toBe(false)
  })

  it("clearAuthState signs every mounted hook out and empties the cache", () => {
    const { result } = renderHook(() => useAuth(), undefined)
    act(() => result.current.login("t"))
    queryClient.setQueryData(["clients"], [1])
    act(() => clearAuthState())
    expect(result.current.isAuthenticated).toBe(false)
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0)
  })

  it("keeps the cache across a token rotation", () => {
    signIn("t")
    queryClient.setQueryData(["clients"], [1])
    signIn("t2")
    expect(queryClient.getQueryData(["clients"])).toEqual([1])
  })
})

describe("expired session", () => {
  it("drops auth state when the refresh cannot renew the session", async () => {
    const { result } = renderHook(() => useAuth(), undefined)
    act(() => result.current.login("t"))
    fakeAuthServer(() => new Response("", { status: 401 })).state.cookie = null
    await act(async () => {
      await apiRequest({ path: "/users" }).catch(() => {})
    })
    expect(result.current.isAuthenticated).toBe(false)
    expect(getAccessToken()).toBeNull()
  })
})

describe("useMe", () => {
  it("does not ask who is signed in while signed out", async () => {
    const { result } = renderQueryHook(() => useMe())
    await until(() => expect(result.current.fetchStatus).toBe("idle"))
    expect(m.me).not.toHaveBeenCalled()
  })

  it("loads the signed-in user", async () => {
    signIn("t")
    m.me.mockResolvedValue({ id: 1, email: "a@gns.id", name: "Ani", role: "finance" })
    const { result } = renderQueryHook(() => useMe())
    await until(() => expect(result.current.data?.role).toBe("finance"))
  })
})
