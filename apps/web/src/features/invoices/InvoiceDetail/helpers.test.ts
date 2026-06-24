import { describe, expect, it } from "vitest"
import type { InvoiceBackendRow, InvoiceBackendStatus } from "@/types/api"
import { EDITABLE_STATUS_ORDER, TO_BACKEND, toEditable } from "./helpers"

function row(status: InvoiceBackendStatus, dueDate?: string): InvoiceBackendRow {
  return { status, dueDate } as InvoiceBackendRow
}

describe("toEditable", () => {
  it("maps paid to DIBAYAR (not DIKIRIM) so saving never demotes a paid invoice", () => {
    expect(toEditable(row("paid"))).toBe("DIBAYAR")
  })

  it("maps sent to DIKIRIM", () => {
    expect(toEditable(row("sent"))).toBe("DIKIRIM")
  })

  it("maps sent past its due date to TERLAMBAT, matching the list", () => {
    expect(toEditable(row("sent", "2000-01-01"))).toBe("TERLAMBAT")
  })

  it("keeps sent with a future due date as DIKIRIM", () => {
    expect(toEditable(row("sent", "2999-01-01"))).toBe("DIKIRIM")
  })

  it("maps overdue to TERLAMBAT", () => {
    expect(toEditable(row("overdue"))).toBe("TERLAMBAT")
  })

  it("treats a past due date as TERLAMBAT", () => {
    expect(toEditable(row("draft", "2000-01-01"))).toBe("TERLAMBAT")
  })

  it("defaults missing invoice to DRAF", () => {
    expect(toEditable(null)).toBe("DRAF")
    expect(toEditable(undefined)).toBe("DRAF")
  })
})

describe("status round-trip", () => {
  it("paid maps back to paid — the guard target===inv.status holds, so no mutation fires", () => {
    const editable = toEditable(row("paid"))
    expect(TO_BACKEND[editable]).toBe("paid")
  })

  it("every backend status round-trips through the editable map", () => {
    const statuses: InvoiceBackendStatus[] = ["draft", "sent", "paid", "overdue"]
    for (const s of statuses) {
      expect(TO_BACKEND[toEditable(row(s))]).toBe(s)
    }
  })
})

describe("EDITABLE_STATUS_ORDER", () => {
  it("excludes DIBAYAR so paid is never user-selectable", () => {
    expect(EDITABLE_STATUS_ORDER).not.toContain("DIBAYAR")
  })
})
