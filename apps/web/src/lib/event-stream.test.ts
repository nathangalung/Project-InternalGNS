import { describe, expect, it, vi } from "vitest"
import { ApiError } from "./api-client"
import {
  followEventStream,
  isFinalRefusal,
  parseFrames,
  readEvents,
  retryDelay,
  type StreamEvent,
  waitFor,
} from "./event-stream"

// Body of chunks, encoded.
function body(...chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder()
  return new ReadableStream({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch))
      c.close()
    },
  })
}

describe("parseFrames", () => {
  it.each([
    {
      name: "named event with data",
      input: 'event: line\ndata: {"a":1}\n\n',
      events: [{ event: "line", data: '{"a":1}' }],
      rest: "",
    },
    {
      name: "unnamed event defaults to message",
      input: "data: x\n\n",
      events: [{ event: "message", data: "x" }],
      rest: "",
    },
    {
      name: "multi-line data joins with newline",
      input: "data: a\ndata: b\n\n",
      events: [{ event: "message", data: "a\nb" }],
      rest: "",
    },
    {
      name: "comment frame is skipped",
      input: ": ping\n\n",
      events: [],
      rest: "",
    },
    {
      name: "field without a space",
      input: "event:ready\ndata:{}\n\n",
      events: [{ event: "ready", data: "{}" }],
      rest: "",
    },
    {
      name: "CRLF line endings",
      input: "event: ready\r\ndata: {}\r\n\r\n",
      events: [{ event: "ready", data: "{}" }],
      rest: "",
    },
    {
      name: "field without a colon",
      input: "data\n\n",
      events: [{ event: "message", data: "" }],
      rest: "",
    },
    {
      name: "nothing complete yet",
      input: "event: a",
      events: [],
      rest: "event: a",
    },
    {
      name: "unknown field ignored",
      input: "id: 4\nretry: 10\nevent: x\n\n",
      events: [{ event: "x", data: "" }],
      rest: "",
    },
    {
      name: "incomplete frame stays in rest",
      input: "event: a\ndata: 1\n\nevent: b\nda",
      events: [{ event: "a", data: "1" }],
      rest: "event: b\nda",
    },
  ])("$name", ({ input, events, rest }) => {
    expect(parseFrames(input)).toEqual({ events, rest })
  })
})

describe("readEvents", () => {
  it("parses frames split across chunks", async () => {
    const seen: StreamEvent[] = []
    await readEvents(
      body("event: re", "ady\ndata: {}\n", "\n: ping\n\nevent: line\ndata: 1\n\n"),
      (e) => seen.push(e),
    )
    expect(seen).toEqual([
      { event: "ready", data: "{}" },
      { event: "line", data: "1" },
    ])
  })

  it("ends quietly on a null body", async () => {
    const onEvent = vi.fn()
    await readEvents(null, onEvent)
    expect(onEvent).not.toHaveBeenCalled()
  })
})

describe("retryDelay", () => {
  it.each([
    [0, 1000],
    [1, 2000],
    [4, 16000],
    [5, 30000],
    [20, 30000],
  ])("attempt %i waits %i ms", (attempt, ms) => {
    expect(retryDelay(attempt)).toBe(ms)
  })
})

describe("isFinalRefusal", () => {
  it.each([
    { err: new ApiError(404, null, "x"), final: true },
    { err: new ApiError(403, null, "x"), final: true },
    { err: new ApiError(401, null, "x"), final: true },
    { err: new ApiError(408, null, "x"), final: false },
    { err: new ApiError(429, null, "x"), final: false },
    { err: new ApiError(503, null, "x"), final: false },
    { err: new TypeError("network"), final: false },
  ])("$err.message $final", ({ err, final }) => {
    expect(isFinalRefusal(err)).toBe(final)
  })
})

describe("waitFor", () => {
  it("resolves after the delay", async () => {
    vi.useFakeTimers()
    const done = vi.fn()
    void waitFor(500, new AbortController().signal).then(done)
    await vi.advanceTimersByTimeAsync(499)
    expect(done).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(done).toHaveBeenCalled()
    vi.useRealTimers()
  })

  it("resolves at once when aborted", async () => {
    const ctl = new AbortController()
    const p = waitFor(60_000, ctl.signal)
    ctl.abort()
    await expect(p).resolves.toBeUndefined()
  })

  it("resolves at once when already aborted", async () => {
    const ctl = new AbortController()
    ctl.abort()
    await expect(waitFor(60_000, ctl.signal)).resolves.toBeUndefined()
  })
})

describe("followEventStream", () => {
  const ok = (...chunks: string[]) => new Response(body(...chunks))

  it("reconnects after the stream ends and resets the backoff on ready", async () => {
    const ctl = new AbortController()
    const delays: number[] = []
    const seen: string[] = []
    const responses = [
      () => Promise.reject(new TypeError("down")),
      () => Promise.resolve(ok("event: ready\ndata: {}\n\n")),
      () => Promise.resolve(ok("event: ready\ndata: {}\n\nevent: line\ndata: 1\n\n")),
    ]
    let calls = 0
    await followEventStream({
      open: () => {
        const next = responses[calls++]
        if (!next) {
          ctl.abort()
          return Promise.reject(new DOMException("aborted", "AbortError"))
        }
        return next()
      },
      onEvent: (e) => seen.push(e.event),
      signal: ctl.signal,
      wait: (ms) => {
        delays.push(ms)
        return Promise.resolve()
      },
    })
    expect(seen).toEqual(["ready", "ready", "line"])
    // Failure backs off from 1s; each ready starts over.
    expect(delays).toEqual([1000, 1000, 1000])
  })

  it("backs off on repeated failures", async () => {
    const ctl = new AbortController()
    const delays: number[] = []
    await followEventStream({
      open: () => Promise.reject(new ApiError(503, null, "x")),
      onEvent: vi.fn(),
      signal: ctl.signal,
      wait: (ms) => {
        delays.push(ms)
        if (delays.length === 3) ctl.abort()
        return Promise.resolve()
      },
    })
    expect(delays).toEqual([1000, 2000, 4000])
  })

  it("stops on a final refusal", async () => {
    const open = vi.fn(() => Promise.reject(new ApiError(404, null, "x")))
    const wait = vi.fn(() => Promise.resolve())
    await followEventStream({
      open,
      onEvent: vi.fn(),
      signal: new AbortController().signal,
      wait,
    })
    expect(open).toHaveBeenCalledTimes(1)
    expect(wait).not.toHaveBeenCalled()
  })

  it("never opens when already aborted", async () => {
    const ctl = new AbortController()
    ctl.abort()
    const open = vi.fn()
    await followEventStream({ open, onEvent: vi.fn(), signal: ctl.signal })
    expect(open).not.toHaveBeenCalled()
  })

  it("stops without waiting when aborted mid-stream", async () => {
    const ctl = new AbortController()
    const wait = vi.fn(() => Promise.resolve())
    await followEventStream({
      open: () => Promise.resolve(ok("event: ready\ndata: {}\n\n")),
      onEvent: () => ctl.abort(),
      signal: ctl.signal,
      wait,
    })
    expect(wait).not.toHaveBeenCalled()
  })

  it("stops quietly when the open is aborted", async () => {
    const ctl = new AbortController()
    const wait = vi.fn(() => Promise.resolve())
    await followEventStream({
      open: () => {
        ctl.abort()
        return Promise.reject(new DOMException("aborted", "AbortError"))
      },
      onEvent: vi.fn(),
      signal: ctl.signal,
      wait,
    })
    expect(wait).not.toHaveBeenCalled()
  })
})
