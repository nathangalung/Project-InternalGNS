import { describe, expect, it } from "vitest"
import { lockScroll, scrollLockCount } from "./scrollLock"

function fakeMain(offsetWidth: number, clientWidth: number) {
  return { offsetWidth, clientWidth, style: { overflow: "", paddingRight: "" } }
}

describe("lockScroll", () => {
  it("locks once, compensates the gutter, restores on last release", () => {
    const el = fakeMain(1000, 985)
    const outer = lockScroll(el)
    expect(el.style).toEqual({ overflow: "hidden", paddingRight: "15px" })

    const inner = lockScroll(el)
    inner()
    expect(el.style.overflow).toBe("hidden")

    outer()
    expect(el.style).toEqual({ overflow: "", paddingRight: "" })
    expect(scrollLockCount()).toBe(0)
  })

  it("keeps padding when there is no scrollbar", () => {
    const el = fakeMain(320, 320)
    const release = lockScroll(el)
    expect(el.style).toEqual({ overflow: "hidden", paddingRight: "" })
    release()
  })

  it("ignores a repeated release", () => {
    const el = fakeMain(500, 490)
    const a = lockScroll(el)
    const b = lockScroll(el)
    a()
    a()
    expect(el.style.overflow).toBe("hidden")
    b()
    expect(el.style.overflow).toBe("")
  })

  it("counts even without a target", () => {
    const release = lockScroll(null)
    expect(scrollLockCount()).toBe(1)
    release()
    expect(scrollLockCount()).toBe(0)
  })
})
