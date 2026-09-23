import { describe, expect, it } from "vitest"
import { endsSessions } from "./helpers"

describe("endsSessions", () => {
  const before = { role: "operational", isActive: true } as const

  it.each([
    ["no change", { ...before }, false],
    ["role change", { ...before, role: "finance" as const }, true],
    ["deactivation", { ...before, isActive: false }, true],
    ["new password", { ...before, password: "Rahasia1!" }, true],
    ["empty password", { ...before, password: "" }, false],
  ])("%s", (_, after, want) => {
    expect(endsSessions(before, after)).toBe(want)
  })

  it("keeps sessions on reactivation", () => {
    expect(endsSessions({ ...before, isActive: false }, { ...before, isActive: true })).toBe(false)
  })
})
