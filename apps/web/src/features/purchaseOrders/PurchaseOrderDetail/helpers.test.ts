import { describe, expect, it } from "vitest"
import { ApiError } from "@/lib/api-client"
import type { PurchaseOrderRow } from "@/types/api"
import {
  canDownloadDeliveryNote,
  deliveryNoteFileName,
  isInvoiceFiled,
  isPoLocked,
  PO_CONFLICT_MESSAGE,
  PO_LABEL,
  PO_STATUS_CONFIG,
  PO_STATUS_ORDER,
  parseCompletenessIssues,
  poBreakdown,
  poErrorMessage,
} from "./helpers"

// WCAG relative luminance of #RRGGBB.
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

describe("PO status maps", () => {
  it.each(Object.entries(PO_STATUS_CONFIG))("%s badge text is at least 4.5:1", (_, c) => {
    expect(contrast(c.color, c.bg)).toBeGreaterThanOrEqual(4.5)
  })

  it("labels every status in server order", () => {
    expect(PO_STATUS_ORDER).toEqual([
      "PENDING",
      "UPLOADED",
      "ON_PROGRESS",
      "DELIVERED",
      "CANCELLED",
    ])
    expect(PO_LABEL.CANCELLED).toBe("Dibatalkan")
  })
})

describe("isPoLocked", () => {
  it.each([
    ["PENDING", false],
    ["UPLOADED", false],
    ["ON_PROGRESS", false],
    ["DELIVERED", true],
    ["CANCELLED", true],
  ] as const)("%s -> %s", (status, locked) => {
    expect(isPoLocked(status)).toBe(locked)
  })
})

describe("canDownloadDeliveryNote", () => {
  it.each([
    ["ON_PROGRESS", "DN-1/GNS/IX/2026", true],
    ["DELIVERED", "DN-1/GNS/IX/2026", true],
    ["ON_PROGRESS", undefined, false],
    ["DELIVERED", "  ", false],
    ["UPLOADED", "DN-1/GNS/IX/2026", false],
    ["CANCELLED", "DN-1/GNS/IX/2026", false],
  ] as const)("%s with %s -> %s", (status, deliveryNoteNumber, ok) => {
    expect(canDownloadDeliveryNote({ status, deliveryNoteNumber })).toBe(ok)
  })
})

describe("deliveryNoteFileName", () => {
  it("uses the stored number, safe for a filename", () => {
    expect(deliveryNoteFileName("DN-2600121/GNS/IX/2026")).toBe("DN-2600121_GNS_IX_2026.pdf")
  })
})

describe("isInvoiceFiled", () => {
  it.each([
    [undefined, false],
    ["draft", false],
    ["cancelled", false],
    ["sent", true],
    ["paid", true],
    ["overdue", true],
  ] as const)("%s -> %s", (status, filed) => {
    expect(isInvoiceFiled(status)).toBe(filed)
  })
})

describe("poErrorMessage", () => {
  it("translates the optimistic-lock 409", () => {
    const err = new ApiError(409, null, "purchase order row_version mismatch")
    expect(poErrorMessage(err, "x")).toBe(PO_CONFLICT_MESSAGE)
  })

  it("keeps the filed-invoice 409 prose", () => {
    const msg = "Nomor dan tanggal PO tidak dapat diubah setelah invoice dikirim."
    expect(poErrorMessage(new ApiError(409, null, msg), "x")).toBe(msg)
  })

  it("falls back for an empty message", () => {
    expect(poErrorMessage(new ApiError(500, null, ""), "Gagal.")).toBe("Gagal.")
  })
})

describe("poBreakdown", () => {
  const po = {
    discountPct: "10.00",
    poTotalProduk: "1000000.00",
    poTotalDiscount: "100000.00",
    poSubtotal: "950000.00",
    poDppNilaiLain: "870833.33",
    poPpnAmount: "104500.00",
    poGrandTotal: "1054500.00",
    poTotalProfit: "200000.00",
  } as PurchaseOrderRow

  it("reads every figure from the PO, not the quotation", () => {
    expect(poBreakdown(po)).toEqual({
      totalProduk: 1000000,
      discountPct: 10,
      nominalDiskon: 100000,
      subTotal: 900000,
      dppNilaiLain: 870833.33,
      ppn12: 104500,
      totalProfit: 200000,
      grandTotal: 1054500,
    })
  })
})

describe("parseCompletenessIssues", () => {
  it("reads client and vendor gaps with their ids", () => {
    const body = {
      detail: "…",
      fields: {
        "vendor:9": "Data vendor PT Laut belum lengkap: Lokasi",
        "klien:4": "Data klien PT Samudra, Tbk belum lengkap: NPWP, Alamat",
      },
    }
    expect(parseCompletenessIssues(body)).toEqual([
      {
        kind: "client",
        id: 4,
        name: "PT Samudra, Tbk",
        missing: ["NPWP", "Alamat"],
        message: "Data klien PT Samudra, Tbk belum lengkap: NPWP, Alamat",
      },
      {
        kind: "vendor",
        id: 9,
        name: "PT Laut",
        missing: ["Lokasi"],
        message: "Data vendor PT Laut belum lengkap: Lokasi",
      },
    ])
  })

  it("keeps the raw sentence when it cannot be split", () => {
    const issues = parseCompletenessIssues({ fields: { "klien:4": "Klien belum siap." } })
    expect(issues).toEqual([
      { kind: "client", id: 4, name: undefined, missing: [], message: "Klien belum siap." },
    ])
  })

  it("returns null for other 422 bodies", () => {
    expect(parseCompletenessIssues({ fields: { status: "Perubahan tidak diizinkan." } })).toBeNull()
    expect(parseCompletenessIssues(null)).toBeNull()
    expect(parseCompletenessIssues("text")).toBeNull()
  })
})
