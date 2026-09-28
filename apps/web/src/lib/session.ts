import { API_BASE } from "@/lib/api-base"
import type { RefreshResponse } from "@/types/api"

// Browser session, memory only.
//
// The access token lives in this module and nowhere else; the refresh token
// is an HttpOnly cookie on the API host that no script can read. A page load
// restores the session by rotating that cookie. The tabs of one browser share
// the cookie jar, so every rotation and the logout run under one Web Lock:
// two tabs never present the same cookie at once, which the API would treat
// as a stolen token and answer by revoking every session. The tab that
// rotated hands the new access token to the others on a BroadcastChannel.

const LOCK_NAME = "gns-session"
const CHANNEL_NAME = "gns-session"
// Keys an older build kept in sessionStorage.
const LEGACY_KEYS = ["gns_token", "gns_refresh_token", "gns_auth"]
// The API refuses refresh and logout without it.
export const CSRF_HEADER = "X-GNS-CSRF"
// A rate-limited refresh waits once.
const DEFAULT_RETRY_WAIT_MS = 1_000
const MAX_RETRY_WAIT_MS = 60_000

type TabMessage = { type: "rotated"; token: string } | { type: "ended" }

let accessToken: string | null = null
// Bumped whenever the session changes hands.
let generation = 0
// The generation whose restore was refused.
let refusedIn = -1
let channel: BroadcastChannel | null = null
let inFlight: Promise<string | null> | null = null
// In-tab queue without Web Locks.
let queue: Promise<unknown> = Promise.resolve()
const listeners = new Set<() => void>()

export function getAccessToken(): string | null {
  return accessToken
}

export function isSignedIn(): boolean {
  return accessToken !== null
}

// Change feed for React.
export function subscribeSession(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function setToken(token: string | null): void {
  if (token === accessToken) return
  accessToken = token
  for (const listener of listeners) listener()
}

function post(message: TabMessage): void {
  channel?.postMessage(message)
}

function isTabMessage(data: unknown): data is TabMessage {
  if (!data || typeof data !== "object") return false
  const m = data as Record<string, unknown>
  return m.type === "ended" || (m.type === "rotated" && typeof m.token === "string")
}

function receive(data: unknown): void {
  if (!isTabMessage(data)) return
  if (data.type === "ended") {
    endSession()
    return
  }
  // A signed-out tab stays signed out.
  if (accessToken !== null) setToken(data.token)
}

// App start: purge, then listen.
//
// Tokens an older build left in sessionStorage are removed unread.
export function startSession(): void {
  try {
    for (const key of LEGACY_KEYS) sessionStorage.removeItem(key)
  } catch {
    // Blocked storage holds nothing to purge.
  }
  if (channel || typeof BroadcastChannel !== "function") return
  channel = new BroadcastChannel(CHANNEL_NAME)
  channel.onmessage = (event: MessageEvent) => receive(event.data)
}

// One session step at a time.
//
// Across tabs through Web Locks where the browser has them, within this tab
// otherwise.
function exclusive<T>(work: () => Promise<T>): Promise<T> {
  const locks: LockManager | undefined = globalThis.navigator?.locks
  if (locks) return locks.request(LOCK_NAME, work)
  const run = queue.then(work)
  queue = run.then(
    () => {},
    () => {},
  )
  return run
}

function postAuth(path: string): Promise<Response> {
  return fetch(`${API_BASE}${path}`, {
    method: "POST",
    credentials: "include",
    headers: { [CSRF_HEADER]: "1" },
  })
}

// Rate-limit wait from Retry-After.
//
// Only delta-seconds, as the API sends; anything else waits a second.
function retryWait(res: Response): number {
  const value = res.headers.get("Retry-After")?.trim()
  if (!value || !/^\d+$/.test(value)) return DEFAULT_RETRY_WAIT_MS
  return Math.min(Number(value) * 1000, MAX_RETRY_WAIT_MS)
}

async function requestToken(): Promise<string | null> {
  try {
    let res = await postAuth("/auth/refresh")
    // The limiter refuses before the cookie is read, so it is still good.
    if (res.status === 429) {
      await new Promise((resolve) => setTimeout(resolve, retryWait(res)))
      res = await postAuth("/auth/refresh")
    }
    if (!res.ok) return null
    return ((await res.json()) as RefreshResponse).token
  } catch {
    return null
  }
}

async function rotate(stale: string | null): Promise<string | null> {
  const started = generation
  return exclusive(async () => {
    // A peer tab rotated while this one waited.
    if (accessToken !== null && accessToken !== stale) return accessToken
    const token = await requestToken()
    // Signed out or in again meanwhile.
    if (generation !== started || token === null) return null
    setToken(token)
    post({ type: "rotated", token })
    return token
  })
}

// New access token, or null.
//
// stale is the token a refused request carried; a newer one already held is
// returned without another rotation. Callers in one tab share the request.
export function refreshSession(stale: string | null = accessToken): Promise<string | null> {
  inFlight ??= rotate(stale).finally(() => {
    inFlight = null
  })
  return inFlight
}

// Signed in, restoring once.
//
// A refused restore is not retried until the session changes, so a signed-out
// reader pays one refresh per page load, not one per route.
export async function restoreSession(): Promise<boolean> {
  if (accessToken !== null) return true
  if (refusedIn === generation) return false
  const started = generation
  const token = await refreshSession(null)
  if (token === null && generation === started) refusedIn = started
  return token !== null
}

// A new session from login.
//
// The jar's cookie now belongs to it, so any other tab's session is over.
export function signIn(token: string): void {
  generation++
  setToken(token)
  post({ type: "ended" })
}

// Drop this tab's session.
//
// Local only: the server is not asked, and other tabs are not told.
export function endSession(): void {
  generation++
  setToken(null)
}

// Sign out every tab.
//
// The revoke queues behind any rotation already running, so it always
// carries the newest cookie; a failed revoke still signs out locally.
export function signOut(): Promise<void> {
  endSession()
  const revoked = exclusive(async () => {
    try {
      await postAuth("/auth/logout")
    } catch {
      // The cookie dies with its refresh expiry.
    }
  })
  post({ type: "ended" })
  return revoked
}
