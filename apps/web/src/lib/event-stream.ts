import { ApiError } from "@/lib/api-client"

// Server-sent events over fetch.
//
// EventSource cannot send the Authorization header, so the stream is a
// plain authed fetch whose body is read as text/event-stream. Only the
// fields the API writes are read: event, data and comments.

export type StreamEvent = { event: string; data: string }

// Retry clocks
const FIRST_RETRY_MS = 1000
const MAX_RETRY_MS = 30_000

// Complete frames, plus the unfinished tail.
export function parseFrames(buffer: string): { events: StreamEvent[]; rest: string } {
  const text = buffer.replace(/\r\n/g, "\n")
  const end = text.lastIndexOf("\n\n")
  const rest = end < 0 ? text : text.slice(end + 2)
  const frames = end < 0 ? [] : text.slice(0, end).split("\n\n")
  const events: StreamEvent[] = []
  for (const frame of frames) {
    let event = ""
    const data: string[] = []
    for (const line of frame.split("\n")) {
      if (line.startsWith(":")) continue
      const colon = line.indexOf(":")
      const field = colon < 0 ? line : line.slice(0, colon)
      const value = colon < 0 ? "" : line.slice(colon + 1).replace(/^ /, "")
      if (field === "event") event = value
      else if (field === "data") data.push(value)
    }
    if (!event && data.length === 0) continue
    events.push({ event: event || "message", data: data.join("\n") })
  }
  return { events, rest }
}

// Read one stream to its end.
export async function readEvents(
  body: ReadableStream<Uint8Array> | null,
  onEvent: (e: StreamEvent) => void,
): Promise<void> {
  if (!body) return
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  for (;;) {
    const { done, value } = await reader.read()
    if (done) return
    buffer += decoder.decode(value, { stream: true })
    const { events, rest } = parseFrames(buffer)
    buffer = rest
    for (const e of events) onEvent(e)
  }
}

// Doubling wait, capped.
export function retryDelay(attempt: number): number {
  return Math.min(FIRST_RETRY_MS * 2 ** attempt, MAX_RETRY_MS)
}

// Refusals a retry cannot fix.
//
// A 401 here means the refresh already failed and the session is over.
export function isFinalRefusal(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false
  return err.status >= 400 && err.status < 500 && err.status !== 408 && err.status !== 429
}

// Sleep that an abort cuts short.
export function waitFor(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve()
    const done = () => {
      clearTimeout(timer)
      signal.removeEventListener("abort", done)
      resolve()
    }
    const timer = setTimeout(done, ms)
    signal.addEventListener("abort", done)
  })
}

type FollowOptions = {
  open: (signal: AbortSignal) => Promise<Response>
  onEvent: (e: StreamEvent) => void
  signal: AbortSignal
  wait?: (ms: number, signal: AbortSignal) => Promise<void>
}

// Keep a stream open.
//
// The server ends every stream after a while, so a reconnect is the normal
// path: each one waits, doubling after failures, and a "ready" frame starts
// the backoff over. Runs until the signal aborts or the server refuses for
// good.
export async function followEventStream({
  open,
  onEvent,
  signal,
  wait = waitFor,
}: FollowOptions): Promise<void> {
  let attempt = 0
  while (!signal.aborted) {
    try {
      const res = await open(signal)
      await readEvents(res.body, (e) => {
        if (e.event === "ready") attempt = 0
        onEvent(e)
      })
    } catch (err) {
      if (isFinalRefusal(err)) return
    }
    if (signal.aborted) return
    await wait(retryDelay(attempt++), signal)
  }
}
