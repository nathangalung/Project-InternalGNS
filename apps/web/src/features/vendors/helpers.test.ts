import { describe, expect, it } from "vitest"
import type { Role } from "@/types/api"
import { canWriteVendors, vendorItemsSummary } from "./helpers"

describe("canWriteVendors", () => {
  const cases: { role: Role | undefined; want: boolean }[] = [
    { role: "superadmin", want: true },
    { role: "operational", want: true },
    { role: "finance", want: false },
    { role: undefined, want: false },
  ]
  for (const c of cases) {
    it(`${c.role ?? "unknown"} -> ${c.want}`, () => {
      expect(canWriteVendors(c.role)).toBe(c.want)
    })
  }
})

describe("vendorItemsSummary", () => {
  const cases = [
    { name: "empty list", shown: 0, limit: 200, count: "0", capped: false },
    { name: "below the cap", shown: 57, limit: 200, count: "57", capped: false },
    { name: "at the cap", shown: 200, limit: 200, count: "200+", capped: true },
  ]
  for (const c of cases) {
    it(c.name, () => {
      const s = vendorItemsSummary(c.shown, c.limit)
      expect(s.count).toBe(c.count)
      expect(s.notice !== null).toBe(c.capped)
    })
  }
})
