import { describe, expect, it } from "vitest"
import { PO_TRANSITIONS, poNumberFromQuotationNo } from "./helpers"

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

describe("PO_TRANSITIONS", () => {
  it("mirrors the backend forward state machine", () => {
    expect(PO_TRANSITIONS.PENDING).toEqual(["UPLOADED"])
    expect(PO_TRANSITIONS.UPLOADED).toEqual(["ON_PROGRESS", "PENDING"])
    expect(PO_TRANSITIONS.ON_PROGRESS).toEqual(["DELIVERED", "UPLOADED"])
  })

  it("treats DELIVERED as terminal once an invoice exists", () => {
    expect(PO_TRANSITIONS.DELIVERED).toEqual([])
  })
})
