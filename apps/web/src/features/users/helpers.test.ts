import { describe, expect, it } from "vitest"
import { endsSessions, ROLE_HINT, ROLE_LABEL, ROLE_ORDER } from "./helpers"

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

describe("role labels", () => {
  it("names every role once, in the order the forms list them", () => {
    expect(ROLE_ORDER).toEqual([
      "superadmin",
      "operational",
      "operational_input",
      "finance",
      "finance_input",
    ])
    expect(ROLE_ORDER.map((r) => ROLE_LABEL[r])).toEqual([
      "Super Admin",
      "Kepala Operasional",
      "Input Data Operasional",
      "Kepala Keuangan",
      "Input Data Keuangan",
    ])
    for (const r of ROLE_ORDER) expect(ROLE_HINT[r].length).toBeGreaterThan(0)
  })
})
