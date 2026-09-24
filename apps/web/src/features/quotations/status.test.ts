import { describe, expect, it } from "vitest"
import { ApiError } from "@/lib/api-client"
import type { QuotationTransition } from "@/types/api"
import {
  fieldError,
  isEditable,
  QUOTATION_STATUS_LABELS,
  QUOTATION_STATUSES,
  quotationBadge,
  quotationStatusFromLabel,
  quotationStatusLabel,
  splitTransitions,
  statTiles,
  statusChangeToast,
  statusHint,
  transitionCopy,
} from "./status"

function move(to: QuotationTransition["to"], label: string, requiresNote = false) {
  return { to, label, requiresNote }
}

describe("status labels", () => {
  it("round-trips every status", () => {
    for (const s of QUOTATION_STATUSES) {
      expect(quotationStatusFromLabel(quotationStatusLabel(s))).toBe(s)
    }
  })

  it("uses the KBBI spelling and names cancelled", () => {
    expect(quotationStatusLabel("expired")).toBe("Kedaluwarsa")
    expect(quotationStatusLabel("cancelled")).toBe("Dibatalkan")
  })

  it("lists labels in server order", () => {
    expect(QUOTATION_STATUS_LABELS).toEqual([
      "Draf",
      "Dikirim",
      "Revisi",
      "Disetujui",
      "Ditolak",
      "Dibatalkan",
      "Kedaluwarsa",
    ])
  })

  it("has a badge for every label", () => {
    for (const l of QUOTATION_STATUS_LABELS) expect(quotationBadge[l]).toBeDefined()
  })
})

describe("splitTransitions menu", () => {
  it("pulls cancel out of the menu", () => {
    const { moves, cancel } = splitTransitions([
      move("accepted", "Disetujui"),
      move("rejected", "Ditolak", true),
      move("cancelled", "Dibatalkan", true),
    ])
    expect(moves.map((m) => m.to)).toEqual(["accepted", "rejected"])
    expect(cancel?.requiresNote).toBe(true)
  })

  it("is empty for a terminal status", () => {
    expect(splitTransitions([])).toEqual({ moves: [], cancel: undefined })
  })
})

describe("isEditable status", () => {
  it("allows draft only", () => {
    expect(QUOTATION_STATUSES.filter(isEditable)).toEqual(["draft"])
  })
})

describe("statusHint copy", () => {
  it("has text for every status", () => {
    for (const s of QUOTATION_STATUSES) expect(statusHint(s).length).toBeGreaterThan(0)
  })
})

describe("transitionCopy dialog", () => {
  it("warns that accepting creates a PO", () => {
    expect(transitionCopy(move("accepted", "Disetujui"), "Dikirim").body).toMatch(/PO/)
  })

  it("names the cancel action", () => {
    expect(transitionCopy(move("cancelled", "Dibatalkan", true), "Draf").submit).toBe(
      "Batalkan Quotation",
    )
  })

  it("states the move for others", () => {
    expect(transitionCopy(move("sent", "Dikirim"), "Draf").body).toBe(
      "Status quotation akan diubah dari Draf menjadi Dikirim.",
    )
  })
})

describe("statTiles order", () => {
  it("keeps the server order and labels", () => {
    const rows = [
      { status: "draft" as const, label: "Draf", count: 2 },
      { status: "cancelled" as const, label: "Dibatalkan", count: 3 },
    ]
    expect(statTiles(rows)).toEqual({ total: 5, tiles: rows })
  })

  it("shows zero tiles before data", () => {
    const { total, tiles } = statTiles(undefined)
    expect(total).toBe(0)
    expect(tiles.map((t) => t.label)).toEqual(QUOTATION_STATUS_LABELS)
  })
})

describe("fieldError lookup", () => {
  const err = new ApiError(422, { fields: { note: "Alasan wajib diisi." } }, "x")

  it("reads a 422 field", () => {
    expect(fieldError(err, "note")).toBe("Alasan wajib diisi.")
  })

  it("ignores other fields and statuses", () => {
    expect(fieldError(err, "status")).toBeUndefined()
    expect(fieldError(new ApiError(409, { fields: { note: "x" } }, "x"), "note")).toBeUndefined()
    expect(fieldError(new Error("x"), "note")).toBeUndefined()
  })
})

describe("statusChangeToast", () => {
  it("stays quiet for a note the modal shows inline", () => {
    const err = new ApiError(422, { fields: { note: "Alasan wajib diisi." } }, "Validasi gagal.")
    expect(statusChangeToast(err)).toBeUndefined()
  })

  it("toasts any other failure", () => {
    const conflict = new ApiError(409, {}, "Status sudah berubah.")
    expect(statusChangeToast(conflict)).toBe("Status sudah berubah.")
    const other = new ApiError(422, { fields: { status: "x" } }, "Status tidak valid.")
    expect(statusChangeToast(other)).toBe("Status tidak valid.")
    expect(statusChangeToast(new ApiError(500, {}, ""))).toBe("Gagal mengubah status quotation.")
  })
})
