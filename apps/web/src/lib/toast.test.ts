import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ToastItem } from "./toast"

type ToastModule = typeof import("./toast")

// Fresh module per test: the queue is a module singleton.
async function load(): Promise<{ mod: ToastModule; seen: ToastItem[][] }> {
  vi.resetModules()
  const mod = await import("./toast")
  const seen: ToastItem[][] = []
  mod.subscribe((items) => seen.push(items))
  return { mod, seen }
}

const last = (seen: ToastItem[][]) => seen[seen.length - 1]

describe("toast", () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it("hands a new subscriber the current queue at once", async () => {
    const { mod, seen } = await load()
    expect(seen).toEqual([[]])
    mod.toast.info("Halo")
    const late: ToastItem[][] = []
    mod.subscribe((items) => late.push(items))
    expect(late).toEqual([[{ id: 1, message: "Halo", variant: "info" }]])
  })

  it("tags each message with its variant and a rising id", async () => {
    const { mod, seen } = await load()
    const a = mod.toast.success("Disimpan.")
    const b = mod.toast.error("Gagal.")
    expect(b).toBeGreaterThan(a)
    expect(last(seen)).toEqual([
      { id: a, message: "Disimpan.", variant: "success" },
      { id: b, message: "Gagal.", variant: "error" },
    ])
  })

  it("keeps only the four newest", async () => {
    const { mod, seen } = await load()
    for (const n of [1, 2, 3, 4, 5]) mod.toast.info(`#${n}`)
    expect(last(seen).map((t) => t.message)).toEqual(["#2", "#3", "#4", "#5"])
  })

  it("dismisses itself after 4.5 seconds", async () => {
    const { mod, seen } = await load()
    mod.toast.info("Sebentar")
    vi.advanceTimersByTime(4499)
    expect(last(seen)).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(last(seen)).toEqual([])
  })

  it("dismisses by hand and cancels the timer", async () => {
    const { mod, seen } = await load()
    const id = mod.toast.error("Tutup")
    mod.toast.dismiss(id)
    expect(last(seen)).toEqual([])
    expect(vi.getTimerCount()).toBe(0)
  })

  it("ignores an unknown id", async () => {
    const { mod, seen } = await load()
    mod.toast.info("Tetap")
    mod.dismiss(999)
    expect(last(seen).map((t) => t.message)).toEqual(["Tetap"])
  })

  it("stops notifying after unsubscribe", async () => {
    const { mod } = await load()
    const calls: ToastItem[][] = []
    const off = mod.subscribe((items) => calls.push(items))
    off()
    mod.toast.info("Diam")
    expect(calls).toEqual([[]])
  })

  it("hands out snapshots, not the live queue", async () => {
    const { mod, seen } = await load()
    mod.toast.info("A")
    const snapshot = last(seen)
    mod.toast.info("B")
    expect(snapshot.map((t) => t.message)).toEqual(["A"])
  })
})
