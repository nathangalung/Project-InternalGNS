import { describe, expect, it } from "vitest"
import { poNumberFromQuotationNo } from "./helpers"

describe("poNumberFromQuotationNo", () => {
  it("replaces the Q- prefix with PO-", () => {
    expect(poNumberFromQuotationNo("Q-2640034/GNS/I/2026")).toBe("PO-2640034/GNS/I/2026")
  })

  it("keeps the dash for a bare Q prefix (no hyphen)", () => {
    expect(poNumberFromQuotationNo("Q2640034")).toBe("PO-2640034")
  })

  it("prefixes PO- when there is no Q prefix at all", () => {
    expect(poNumberFromQuotationNo("2640034")).toBe("PO-2640034")
  })
})
