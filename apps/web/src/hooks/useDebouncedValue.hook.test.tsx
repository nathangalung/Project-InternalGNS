import { act } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { renderHook } from "@/test/renderHook"
import { useDebouncedValue } from "./useDebouncedValue"

describe("useDebouncedValue", () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  type Props = { v: string; d?: number }
  const render = (value: string, delay?: number) =>
    renderHook(({ v, d }: Props) => useDebouncedValue(v, d), { v: value, d: delay } as Props)

  it("returns the initial value at once", () => {
    const { result } = render("a")
    expect(result.current).toBe("a")
  })

  it("publishes a change only after the delay", () => {
    const { result, rerender } = render("a", 100)
    rerender({ v: "ab", d: 100 })
    act(() => vi.advanceTimersByTime(99))
    expect(result.current).toBe("a")
    act(() => vi.advanceTimersByTime(1))
    expect(result.current).toBe("ab")
  })

  it("restarts the timer on each change so only the last value lands", () => {
    const { result, rerender } = render("a")
    rerender({ v: "ab" })
    act(() => vi.advanceTimersByTime(200))
    rerender({ v: "abc" })
    act(() => vi.advanceTimersByTime(200))
    expect(result.current).toBe("a")
    act(() => vi.advanceTimersByTime(50))
    expect(result.current).toBe("abc")
  })

  it("cancels the pending update on unmount", () => {
    const { rerender, unmount } = render("a")
    rerender({ v: "b" })
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})
