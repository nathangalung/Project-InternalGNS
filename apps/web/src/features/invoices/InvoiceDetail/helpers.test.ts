import { describe, expect, it } from "vitest"
import type { InvoiceBackendRow, InvoiceBackendStatus } from "@/types/api"
import { EDITABLE_STATUS_ORDER, TO_BACKEND, toEditable } from "./helpers"

function row(status: InvoiceBackendStatus, dueDate?: string): InvoiceBackendRow {
  return { status, dueDate } as InvoiceBackendRow
}

// Derivation itself is covered in lib/status.test.ts.
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
