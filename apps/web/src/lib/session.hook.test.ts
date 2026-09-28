import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { FakeChannel, fakeAuthServer, flush, header, installBrowser } from "@/test/tabs"

type Session = typeof import("./session")

// One tab: a fresh module instance.
async function openTab(): Promise<Session> {
  vi.resetModules()
  const tab = await import("./session")
  tab.startSession()
  return tab
}

beforeEach(() => {
  sessionStorage.clear()
  localStorage.clear()
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("access token store", () => {
  it("starts signed out and keeps the token in memory only", async () => {
    installBrowser()
    const tab = await openTab()
    expect(tab.isSignedIn()).toBe(false)
    const seen = vi.fn()
    const stop = tab.subscribeSession(seen)
    tab.signIn("a1")
    expect(tab.getAccessToken()).toBe("a1")
    expect(tab.isSignedIn()).toBe(true)
    expect(seen).toHaveBeenCalledTimes(1)
    expect(sessionStorage.length).toBe(0)
    expect(localStorage.length).toBe(0)
    tab.endSession()
    expect(tab.isSignedIn()).toBe(false)
    expect(seen).toHaveBeenCalledTimes(2)
    stop()
    tab.signIn("a2")
    expect(seen).toHaveBeenCalledTimes(2)
  })

  it("ignores and removes tokens an older build left in sessionStorage", async () => {
    installBrowser()
    sessionStorage.setItem("gns_token", "old")
    sessionStorage.setItem("gns_refresh_token", "old-r")
    sessionStorage.setItem("gns_auth", "true")
    sessionStorage.setItem("other", "keep")
    const tab = await openTab()
    expect(tab.isSignedIn()).toBe(false)
    expect(sessionStorage.getItem("gns_token")).toBeNull()
    expect(sessionStorage.getItem("gns_refresh_token")).toBeNull()
    expect(sessionStorage.getItem("gns_auth")).toBeNull()
    expect(sessionStorage.getItem("other")).toBe("keep")
  })

  it("starts even when storage is blocked", async () => {
    installBrowser()
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError")
    })
    await expect(openTab()).resolves.toBeDefined()
  })

  it("connects to the other tabs only once", async () => {
    installBrowser()
    const tab = await openTab()
    tab.startSession()
    expect(FakeChannel.open).toHaveLength(1)
  })
})

describe("refresh", () => {
  it("rotates the cookie with credentials and the CSRF header", async () => {
    installBrowser()
    const server = fakeAuthServer()
    const tab = await openTab()
    await expect(tab.refreshSession(null)).resolves.toBe("a2")
    const [call] = server.refreshes()
    expect(call.init.method).toBe("POST")
    expect(call.init.credentials).toBe("include")
    expect(header(call.init, "X-GNS-CSRF")).toBe("1")
    expect(call.init.body).toBeUndefined()
    expect(tab.getAccessToken()).toBe("a2")
  })

  it("shares one refresh between callers in a tab", async () => {
    installBrowser()
    const server = fakeAuthServer()
    const tab = await openTab()
    const out = await Promise.all([tab.refreshSession(null), tab.refreshSession(null)])
    expect(out).toEqual(["a2", "a2"])
    expect(server.refreshes()).toHaveLength(1)
  })

  it("skips the rotation when a newer token already arrived", async () => {
    installBrowser()
    const server = fakeAuthServer()
    const tab = await openTab()
    tab.signIn("a9")
    await expect(tab.refreshSession("a8")).resolves.toBe("a9")
    expect(server.refreshes()).toHaveLength(0)
  })

  it.each([
    ["refused", () => json401()],
    ["unreachable", () => Promise.reject(new TypeError("Failed to fetch"))],
  ])("answers null when the refresh is %s", async (_name, answer) => {
    installBrowser()
    vi.stubGlobal("fetch", vi.fn(answer))
    const tab = await openTab()
    await expect(tab.refreshSession(null)).resolves.toBeNull()
    expect(tab.isSignedIn()).toBe(false)
  })

  it.each([
    ["seconds", "2", 2_000],
    ["zero", "0", 0],
    ["capped", "3600", 60_000],
    ["missing", null, 1_000],
    ["an HTTP date", "Wed, 21 Oct 2026 07:28:00 GMT", 1_000],
    ["negative", "-5", 1_000],
  ])("waits out a rate limit (%s) once, then retries", async (_name, retryAfter, waitMs) => {
    installBrowser()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json429(retryAfter))
      .mockResolvedValueOnce(new Response(JSON.stringify({ token: "a5" }), { status: 200 }))
    vi.stubGlobal("fetch", fetchMock)
    const tab = await openTab()
    vi.useFakeTimers({ toFake: ["setTimeout"] })
    const out = tab.refreshSession(null)
    if (waitMs > 0) {
      await vi.advanceTimersByTimeAsync(waitMs - 1)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    }
    await vi.advanceTimersByTimeAsync(1)
    await expect(out).resolves.toBe("a5")
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(tab.getAccessToken()).toBe("a5")
  })

  it("answers null when the retry is rate limited too", async () => {
    installBrowser()
    const fetchMock = vi.fn(() => Promise.resolve(json429("0")))
    vi.stubGlobal("fetch", fetchMock)
    const tab = await openTab()
    await expect(tab.refreshSession(null)).resolves.toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(tab.isSignedIn()).toBe(false)
  })

  it("defaults to the token the tab holds", async () => {
    installBrowser()
    const server = fakeAuthServer()
    const tab = await openTab()
    tab.signIn("a1")
    await expect(tab.refreshSession()).resolves.toBe("a2")
    expect(server.refreshes()).toHaveLength(1)
  })
})

describe("across tabs", () => {
  it("never lets two tabs present the same refresh cookie", async () => {
    const locks = installBrowser()
    const server = fakeAuthServer()
    const first = await openTab()
    const second = await openTab()
    const out = await Promise.all([first.refreshSession(null), second.refreshSession(null)])
    expect(out.every((t) => t !== null)).toBe(true)
    const presented = server.refreshes().map((c) => c.cookie)
    expect(new Set(presented).size).toBe(presented.length)
    expect(server.state.reused).toBe(0)
    expect(locks.maxHeld).toBe(1)
  })

  it("hands a rotated token to the other signed-in tabs", async () => {
    installBrowser()
    const server = fakeAuthServer()
    const first = await openTab()
    const second = await openTab()
    first.signIn("a1")
    await flush()
    // The second tab restores; the first adopts its rotation.
    await second.restoreSession()
    await flush()
    expect(first.getAccessToken()).toBe("a2")
    await first.refreshSession()
    await flush()
    expect(second.getAccessToken()).toBe("a3")
    expect(server.state.reused).toBe(0)
  })

  it("keeps a signed-out tab signed out when a token is handed round", async () => {
    installBrowser()
    fakeAuthServer()
    const first = await openTab()
    const second = await openTab()
    await first.refreshSession(null)
    await flush()
    expect(second.isSignedIn()).toBe(false)
  })

  it("ends the other tabs when one signs in", async () => {
    installBrowser()
    const first = await openTab()
    const second = await openTab()
    second.signIn("x1")
    await flush()
    first.signIn("y1")
    await flush()
    expect(second.isSignedIn()).toBe(false)
    expect(first.getAccessToken()).toBe("y1")
  })

  it("ignores a message that is not a session message", async () => {
    installBrowser()
    const tab = await openTab()
    tab.signIn("a1")
    const channel = FakeChannel.open[0]
    for (const data of [null, "ended", { type: "rotated" }, { type: "other" }]) {
      channel.onmessage?.({ data } as MessageEvent)
    }
    expect(tab.getAccessToken()).toBe("a1")
  })
})

describe("sign out", () => {
  it("revokes the cookie under the lock and ends every tab", async () => {
    installBrowser()
    const server = fakeAuthServer()
    const first = await openTab()
    const second = await openTab()
    first.signIn("a1")
    await flush()
    await second.restoreSession()
    await flush()
    expect(first.isSignedIn()).toBe(true)
    await first.signOut()
    await flush()
    const logout = server.calls.find((c) => c.path === "/auth/logout")
    expect(logout?.init.credentials).toBe("include")
    expect(header(logout?.init ?? {}, "X-GNS-CSRF")).toBe("1")
    expect(first.isSignedIn()).toBe(false)
    expect(second.isSignedIn()).toBe(false)
  })

  it("waits for a refresh already running, then revokes its successor", async () => {
    installBrowser()
    const server = fakeAuthServer()
    const tab = await openTab()
    tab.signIn("a1")
    const refreshing = tab.refreshSession("a1")
    const out = tab.signOut()
    await expect(refreshing).resolves.toBeNull()
    await out
    const order = server.calls.map((c) => [c.path, c.cookie])
    expect(order).toEqual([
      ["/auth/refresh", "r1"],
      ["/auth/logout", "r2"],
    ])
    expect(tab.isSignedIn()).toBe(false)
  })

  it("still signs out locally when the revoke fails", async () => {
    installBrowser()
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))),
    )
    const tab = await openTab()
    tab.signIn("a1")
    await expect(tab.signOut()).resolves.toBeUndefined()
    expect(tab.isSignedIn()).toBe(false)
  })
})

describe("without Web Locks or BroadcastChannel", () => {
  it("still runs refresh and logout one after the other", async () => {
    installBrowser({ locks: false, channel: false })
    const server = fakeAuthServer()
    const tab = await openTab()
    tab.signIn("a1")
    const refreshing = tab.refreshSession("a1")
    await tab.signOut()
    await refreshing
    expect(server.calls.map((c) => c.cookie)).toEqual(["r1", "r2"])
    expect(tab.isSignedIn()).toBe(false)
  })

  it("keeps queueing after a failed step", async () => {
    installBrowser({ locks: false, channel: false })
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValue(new Response(JSON.stringify({ token: "a5" }), { status: 200 }))
    vi.stubGlobal("fetch", fetchMock)
    const tab = await openTab()
    await tab.signOut()
    await expect(tab.refreshSession(null)).resolves.toBe("a5")
  })
})

describe("restore", () => {
  it("is signed in already without a request", async () => {
    installBrowser()
    const server = fakeAuthServer()
    const tab = await openTab()
    tab.signIn("a1")
    await expect(tab.restoreSession()).resolves.toBe(true)
    expect(server.calls).toHaveLength(0)
  })

  it("restores from the cookie", async () => {
    installBrowser()
    fakeAuthServer()
    const tab = await openTab()
    await expect(tab.restoreSession()).resolves.toBe(true)
    expect(tab.getAccessToken()).toBe("a2")
  })

  it("asks once per session change after a refusal", async () => {
    installBrowser()
    const server = fakeAuthServer()
    server.state.cookie = null
    const tab = await openTab()
    await expect(tab.restoreSession()).resolves.toBe(false)
    await expect(tab.restoreSession()).resolves.toBe(false)
    expect(server.refreshes()).toHaveLength(1)
    tab.endSession()
    await expect(tab.restoreSession()).resolves.toBe(false)
    expect(server.refreshes()).toHaveLength(2)
  })
})

function json401(): Promise<Response> {
  return Promise.resolve(new Response('{"status":401,"title":"Unauthorized"}', { status: 401 }))
}

function json429(retryAfter: string | null): Response {
  const headers: Record<string, string> = { "content-type": "application/problem+json" }
  if (retryAfter !== null) headers["Retry-After"] = retryAfter
  return new Response('{"status":429,"title":"Too Many Requests"}', { status: 429, headers })
}
