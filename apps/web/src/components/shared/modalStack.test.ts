import { describe, expect, it } from "vitest"
import { closeDecision, isTopModal, modalStackDepth, popModal, pushModal } from "./modalStack"

describe("modalStack", () => {
  it("gives a single modal ownership of Escape", () => {
    const a = pushModal()
    expect(isTopModal(a)).toBe(true)
    popModal(a)
    expect(modalStackDepth()).toBe(0)
  })

  it("hands ownership to the modal opened last", () => {
    const outer = pushModal()
    const inner = pushModal()
    expect(isTopModal(inner)).toBe(true)
    expect(isTopModal(outer)).toBe(false)
    popModal(inner)
    popModal(outer)
  })

  it("returns ownership to the outer modal when the inner one closes", () => {
    const outer = pushModal()
    const inner = pushModal()
    popModal(inner)
    expect(isTopModal(outer)).toBe(true)
    popModal(outer)
    expect(modalStackDepth()).toBe(0)
  })

  it("handles out-of-order unmount when the outer closes by button", () => {
    const outer = pushModal()
    const inner = pushModal()
    popModal(outer)
    expect(isTopModal(inner)).toBe(true)
    expect(modalStackDepth()).toBe(1)
    popModal(inner)
    expect(modalStackDepth()).toBe(0)
  })

  it("issues distinct tokens when two modals mount in the same tick", () => {
    const a = pushModal()
    const b = pushModal()
    expect(a).not.toBe(b)
    expect(modalStackDepth()).toBe(2)
    popModal(a)
    popModal(b)
    expect(modalStackDepth()).toBe(0)
  })

  it("ignores a repeated pop of a stale token while another modal is live", () => {
    const outer = pushModal()
    const inner = pushModal()
    popModal(outer)
    popModal(outer)
    expect(isTopModal(inner)).toBe(true)
    expect(modalStackDepth()).toBe(1)
    popModal(inner)
    expect(modalStackDepth()).toBe(0)
  })
})

describe("closeDecision", () => {
  it.each([
    ["escape-key", true, "close"],
    ["escape-key", false, "cancel"],
    ["outside-press", true, "close"],
    ["outside-press", false, "cancel"],
    ["close-press", true, "close"],
    ["close-press", false, "close"],
    ["imperative-action", false, "close"],
  ] as const)("%s with top=%s -> %s", (reason, isTop, expected) => {
    expect(closeDecision(false, reason, isTop)).toBe(expected)
  })

  it("ignores an open request", () => {
    expect(closeDecision(true, "trigger-press", true)).toBe("ignore")
  })
})
