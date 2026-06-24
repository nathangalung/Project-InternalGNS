import { describe, expect, it } from "vitest"
import { labelToStatus, QUOTATION_TRANSITIONS, statusToLabel } from "./status"

describe("expired status", () => {
  it("renders as its own Kadaluarsa label, not Ditolak", () => {
    expect(statusToLabel("expired")).toBe("Kadaluarsa")
    expect(labelToStatus("Kadaluarsa")).toBe("expired")
  })
})

describe("QUOTATION_TRANSITIONS", () => {
  it("mirrors the backend state machine", () => {
    expect(QUOTATION_TRANSITIONS.Draf).toEqual(["Dikirim"])
    expect(QUOTATION_TRANSITIONS.Dikirim).toEqual(["Disetujui", "Ditolak", "Revisi"])
    expect(QUOTATION_TRANSITIONS.Revisi).toEqual(["Dikirim", "Ditolak"])
  })

  it("treats accepted, rejected and expired as terminal", () => {
    expect(QUOTATION_TRANSITIONS.Disetujui).toEqual([])
    expect(QUOTATION_TRANSITIONS.Ditolak).toEqual([])
    expect(QUOTATION_TRANSITIONS.Kadaluarsa).toEqual([])
  })
})
