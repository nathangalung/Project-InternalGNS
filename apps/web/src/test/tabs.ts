import { vi } from "vitest"

// Browser session fakes.
//
// One FakeLocks and one channel bus stand for a browser profile; each module
// instance of lib/session loaded after vi.resetModules() is one tab in it.
// fakeAuthServer keeps the one refresh cookie jar every tab shares and
// rotates it the way the API does, refusing a cookie presented twice.

export class FakeLocks {
  private tails = new Map<string, Promise<unknown>>()
  held = 0
  maxHeld = 0

  request<T>(name: string, callback: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(name) ?? Promise.resolve()
    const run = previous.then(async () => {
      this.held++
      this.maxHeld = Math.max(this.maxHeld, this.held)
      try {
        return await callback()
      } finally {
        this.held--
      }
    })
    this.tails.set(
      name,
      run.catch(() => {}),
    )
    return run
  }
}

export class FakeChannel {
  static open: FakeChannel[] = []
  onmessage: ((event: MessageEvent) => void) | null = null
  readonly sent: unknown[] = []

  constructor(readonly name: string) {
    FakeChannel.open.push(this)
  }

  // Delivers to every other instance, never to itself.
  postMessage(data: unknown): void {
    this.sent.push(data)
    for (const peer of FakeChannel.open) {
      if (peer === this || peer.name !== this.name) continue
      setTimeout(() => peer.onmessage?.({ data } as MessageEvent), 0)
    }
  }

  close(): void {
    FakeChannel.open = FakeChannel.open.filter((c) => c !== this)
  }
}

// Installs the profile fakes.
export function installBrowser(opts: { locks?: boolean; channel?: boolean } = {}): FakeLocks {
  const locks = new FakeLocks()
  FakeChannel.open = []
  Object.defineProperty(navigator, "locks", {
    value: opts.locks === false ? undefined : locks,
    configurable: true,
  })
  vi.stubGlobal("BroadcastChannel", opts.channel === false ? undefined : FakeChannel)
  return locks
}

// Lets queued deliveries run.
export const flush = () => new Promise((resolve) => setTimeout(resolve, 5))

export const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: { "content-type": "application/json", ...init.headers },
  })

export type AuthCall = { path: string; init: RequestInit; cookie: string | null }

type Other = (path: string, init: RequestInit) => Response | Promise<Response>

// API fake with one cookie jar.
//
// Refresh rotates the jar's cookie after a short delay, so two refreshes that
// overlap present the same cookie and the second is refused as a reuse.
export function fakeAuthServer(other: Other = () => json({})) {
  const state = { cookie: "r1" as string | null, next: 1, reused: 0 }
  const redeemed = new Set<string>()
  const calls: AuthCall[] = []
  const fetchMock = vi.fn(async (url: string, init: RequestInit = {}) => {
    const path = url.replace(/^.*\/api\/v1/, "")
    const cookie = state.cookie
    calls.push({ path, init, cookie })
    if (path === "/auth/refresh") {
      await new Promise((resolve) => setTimeout(resolve, 1))
      if (!cookie || redeemed.has(cookie)) {
        if (cookie) state.reused++
        state.cookie = null
        return json({ status: 401, title: "Unauthorized" }, { status: 401 })
      }
      redeemed.add(cookie)
      state.next++
      state.cookie = `r${state.next}`
      return json({ token: `a${state.next}`, expiresAt: 0 })
    }
    if (path === "/auth/logout") {
      state.cookie = null
      return new Response(null, { status: 204 })
    }
    return other(path, init)
  })
  vi.stubGlobal("fetch", fetchMock)
  return {
    state,
    calls,
    fetchMock,
    refreshes: () => calls.filter((c) => c.path === "/auth/refresh"),
  }
}

export const header = (init: RequestInit, name: string) => new Headers(init.headers).get(name)
