import { afterEach, describe, expect, it, vi } from "vitest"
import type { InvoiceBackendRow, InvoiceBackendStatus } from "@/types/api"
import { deriveInvoiceStatus, labelToStatus, QUOTATION_TRANSITIONS, statusToLabel } from "./status"

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

function row(status: InvoiceBackendStatus, dueDate?: string): InvoiceBackendRow {
  return { status, dueDate } as InvoiceBackendRow
}

describe("deriveInvoiceStatus", () => {
  it("maps paid to DIBAYAR (not DIKIRIM) so saving never demotes a paid invoice", () => {
    expect(deriveInvoiceStatus(row("paid"))).toBe("DIBAYAR")
  })

  it("maps sent to DIKIRIM", () => {
    expect(deriveInvoiceStatus(row("sent"))).toBe("DIKIRIM")
  })

  it("maps sent past its due date to TERLAMBAT", () => {
    expect(deriveInvoiceStatus(row("sent", "2000-01-01"))).toBe("TERLAMBAT")
  })

  it("keeps sent with a future due date as DIKIRIM", () => {
    expect(deriveInvoiceStatus(row("sent", "2999-01-01"))).toBe("DIKIRIM")
  })

  it("maps overdue to TERLAMBAT", () => {
    expect(deriveInvoiceStatus(row("overdue"))).toBe("TERLAMBAT")
  })

  it("treats a past due date as TERLAMBAT", () => {
    expect(deriveInvoiceStatus(row("draft", "2000-01-01"))).toBe("TERLAMBAT")
  })

  it("defaults a missing invoice to DRAF", () => {
    expect(deriveInvoiceStatus(null)).toBe("DRAF")
    expect(deriveInvoiceStatus(undefined)).toBe("DRAF")
  })

  it("ignores an unparseable due date", () => {
    expect(deriveInvoiceStatus(row("sent", "not-a-date"))).toBe("DIKIRIM")
  })
})

// Overdue the day after the due date, in Jakarta, matching the server's
// due_date < CURRENT_DATE on a WIB-pinned session.
describe("deriveInvoiceStatus overdue boundary", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it("is not overdue at the start of the due date in Jakarta", () => {
    vi.useFakeTimers()
    // 2026-06-14T17:00Z is 2026-06-15 00:00 WIB.
    vi.setSystemTime(new Date("2026-06-14T17:00:00.000Z"))
    expect(deriveInvoiceStatus(row("sent", "2026-06-15"))).toBe("DIKIRIM")
  })

  it("is not overdue past UTC midnight while still the due date in Jakarta", () => {
    vi.useFakeTimers()
    // 07:00 WIB on the due date. The old UTC comparison flipped here, which
    // made the badge contradict the server's own sent filter for 17 hours.
    vi.setSystemTime(new Date("2026-06-15T00:00:00.001Z"))
    expect(deriveInvoiceStatus(row("sent", "2026-06-15"))).toBe("DIKIRIM")
  })

  it("is not overdue at the last moment of the due date in Jakarta", () => {
    vi.useFakeTimers()
    // 2026-06-15T16:59:59Z is 23:59:59 WIB on the due date.
    vi.setSystemTime(new Date("2026-06-15T16:59:59.000Z"))
    expect(deriveInvoiceStatus(row("sent", "2026-06-15"))).toBe("DIKIRIM")
  })

  it("is overdue once Jakarta reaches the next day", () => {
    vi.useFakeTimers()
    // 2026-06-15T17:00Z is 2026-06-16 00:00 WIB.
    vi.setSystemTime(new Date("2026-06-15T17:00:00.000Z"))
    expect(deriveInvoiceStatus(row("sent", "2026-06-15"))).toBe("TERLAMBAT")
  })
})

describe("deriveInvoiceStatus cancelled", () => {
  it("returns null when cancelledAsNull is set, so the row is filtered out", () => {
    expect(deriveInvoiceStatus(row("cancelled"), { cancelledAsNull: true })).toBeNull()
    expect(
      deriveInvoiceStatus(row("cancelled", "2000-01-01"), { cancelledAsNull: true }),
    ).toBeNull()
  })

  it("falls through to DRAF by default, matching the list and the detail editor", () => {
    expect(deriveInvoiceStatus(row("cancelled"))).toBe("DRAF")
  })

  it("still reports a past-due cancelled invoice as TERLAMBAT by default", () => {
    expect(deriveInvoiceStatus(row("cancelled", "2000-01-01"))).toBe("TERLAMBAT")
  })

  it("leaves non-cancelled rows unaffected by cancelledAsNull", () => {
    expect(deriveInvoiceStatus(row("paid"), { cancelledAsNull: true })).toBe("DIBAYAR")
  })
})
