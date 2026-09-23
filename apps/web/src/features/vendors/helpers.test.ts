import { describe, expect, it } from "vitest"
import { vendorItemsSummary } from "./helpers"

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
