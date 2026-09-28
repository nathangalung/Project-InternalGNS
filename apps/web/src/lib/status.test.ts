import { describe, expect, it } from "vitest"
import type { InvoiceBackendRow, InvoiceBackendStatus } from "@/types/api"
import {
  deriveInvoiceStatus,
  QUOTATION_STATUS_LABELS,
  QUOTATION_STATUSES,
  quotationBadge,
  quotationStatusFromLabel,
  quotationStatusLabel,
} from "./status"

describe("quotation status labels", () => {
  it("round-trips every status", () => {
    for (const s of QUOTATION_STATUSES) {
      expect(quotationStatusFromLabel(quotationStatusLabel(s))).toBe(s)
    }
  })

  const cases = [
    { status: "expired", want: "Kedaluwarsa" },
    { status: "cancelled", want: "Dibatalkan" },
    { status: "rejected", want: "Ditolak" },
  ] as const
  for (const c of cases) {
    it(`labels ${c.status} as ${c.want}`, () => {
      expect(quotationStatusLabel(c.status)).toBe(c.want)
    })
  }

  it("has a badge for every label", () => {
    for (const label of QUOTATION_STATUS_LABELS) {
      expect(quotationBadge[label]).toBeDefined()
    }
  })
})

function row(
  status: InvoiceBackendStatus,
  effectiveStatus: InvoiceBackendStatus = status,
  dueDate?: string,
): InvoiceBackendRow {
  return { status, effectiveStatus, dueDate } as InvoiceBackendRow
}

// The server's rule, never recomputed.
describe("deriveInvoiceStatus", () => {
  it.each<[string, InvoiceBackendRow, string]>([
    ["paid stays DIBAYAR", row("paid"), "DIBAYAR"],
    ["sent is DIKIRIM", row("sent"), "DIKIRIM"],
    ["draft is DRAF", row("draft"), "DRAF"],
    ["stored overdue is TERLAMBAT", row("overdue"), "TERLAMBAT"],
    ["server-derived overdue sent", row("sent", "overdue", "2026-06-15"), "TERLAMBAT"],
    ["server-derived overdue draft", row("draft", "overdue", "2026-06-15"), "TERLAMBAT"],
    // The server says sent, so a stale browser clock cannot flip it.
    ["sent the server still calls sent", row("sent", "sent", "2000-01-01"), "DIKIRIM"],
    ["cancelled falls through to DRAF", row("cancelled", "cancelled", "2000-01-01"), "DRAF"],
  ])("%s", (_name, inv, want) => {
    expect(deriveInvoiceStatus(inv)).toBe(want)
  })

  it("defaults a missing invoice to DRAF", () => {
    expect(deriveInvoiceStatus(null)).toBe("DRAF")
    expect(deriveInvoiceStatus(undefined)).toBe("DRAF")
  })

  it("drops cancelled rows when cancelledAsNull is set", () => {
    expect(deriveInvoiceStatus(row("cancelled"), { cancelledAsNull: true })).toBeNull()
    expect(deriveInvoiceStatus(row("paid"), { cancelledAsNull: true })).toBe("DIBAYAR")
  })
})
