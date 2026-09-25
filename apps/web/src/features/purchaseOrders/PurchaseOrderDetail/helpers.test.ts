import { describe, expect, it } from "vitest"
import { ApiError } from "@/lib/api-client"
import type { PurchaseOrderRow } from "@/types/api"
import {
  canDownloadDeliveryNote,
  deliveryNoteFileName,
  isInvoiceFiled,
  isPoLocked,
  isPoLockRefusal,
  isVersionConflict,
  PO_CONFLICT_MESSAGE,
  PO_LABEL,
  PO_LOCKED_CODE,
  PO_STATUS_CONFIG,
  PO_STATUS_ORDER,
  parseCompletenessIssues,
  poBreakdown,
  poErrorMessage,
  shortDocNo,
  uploadRules,
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

  it("keeps the lock 409 prose", () => {
    const msg = "Nomor dan tanggal PO tidak dapat diubah setelah invoice dikirim."
    const body = { status: 409, detail: msg, code: "po_locked" }
    expect(poErrorMessage(new ApiError(409, body, msg), "x")).toBe(msg)
  })

  it("falls back for an empty message", () => {
    expect(poErrorMessage(new ApiError(500, null, ""), "Gagal.")).toBe("Gagal.")
  })
})

describe("409 classification", () => {
  const lockBody = { status: 409, detail: "Berkas PO tidak dapat diubah.", code: "po_locked" }
  it.each([
    ["lock with code", new ApiError(409, lockBody, "Berkas PO tidak dapat diubah."), true, false],
    ["lock that mentions row_version", new ApiError(409, lockBody, "row_version"), true, false],
    [
      "If-Match mismatch",
      new ApiError(409, { status: 409 }, "purchase order row_version mismatch"),
      false,
      true,
    ],
    ["409 without code or version", new ApiError(409, null, "Konflik."), false, false],
    ["other code", new ApiError(409, { code: "other" }, "Konflik."), false, false],
    ["422 with the lock code", new ApiError(422, lockBody, "x"), false, false],
    ["plain Error", new Error("row_version"), false, false],
  ] as const)("%s", (_, err, lock, version) => {
    expect(isPoLockRefusal(err)).toBe(lock)
    expect(isVersionConflict(err)).toBe(version)
  })

  it("names the server code", () => {
    expect(PO_LOCKED_CODE).toBe("po_locked")
  })
})

describe("uploadRules", () => {
  it.each([
    // status, hasFile, detailsLocked -> fileLocked, needsFile, editable
    ["PENDING", false, false, false, true, true],
    ["PENDING", true, false, false, false, true],
    ["UPLOADED", true, false, false, false, true],
    ["ON_PROGRESS", false, false, false, true, true],
    // Reached work with no file (PO-13): details stay fixable
    ["DELIVERED", false, false, true, false, true],
    ["DELIVERED", true, false, true, false, true],
    ["DELIVERED", true, true, true, false, false],
    ["CANCELLED", false, false, true, false, true],
    ["CANCELLED", true, true, true, false, false],
    // An open file keeps the modal useful
    ["UPLOADED", true, true, false, false, true],
  ] as const)(
    "%s file=%s locked=%s",
    (status, hasFile, locked, fileLocked, needsFile, editable) => {
      expect(uploadRules(status, hasFile, locked)).toEqual({ fileLocked, needsFile, editable })
    },
  )
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

  it("reads a shipping line gap by its line number, not its row id", () => {
    const issues = parseCompletenessIssues({
      fields: { "baris:731": "Alamat pengiriman baris 2 belum diisi" },
    })
    expect(issues).toEqual([
      {
        kind: "line",
        id: 2,
        name: "Baris 2",
        missing: ["Alamat Pengiriman"],
        message: "Alamat pengiriman baris 2 belum diisi",
      },
    ])
  })

  it("keeps the raw sentence of an unreadable line gap", () => {
    const issues = parseCompletenessIssues({ fields: { "baris:731": "Baris belum siap." } })
    expect(issues).toEqual([
      { kind: "line", id: 731, name: undefined, missing: [], message: "Baris belum siap." },
    ])
  })

  it("returns null for other 422 bodies", () => {
    expect(parseCompletenessIssues({ fields: { status: "Perubahan tidak diizinkan." } })).toBeNull()
    expect(parseCompletenessIssues(null)).toBeNull()
    expect(parseCompletenessIssues("text")).toBeNull()
  })
})

describe("shortDocNo", () => {
  it.each<[string, string]>([
    ["001/GNS/Q/IX/2026", "001…"],
    ["PO-77", "PO-77"],
    ["/GNS", "…"],
  ])("%s -> %s", (no, want) => {
    expect(shortDocNo(no)).toBe(want)
  })
})

describe("parseCompletenessIssues ordering", () => {
  it("puts the client first, then vendors by id", () => {
    const issues = parseCompletenessIssues({
      fields: {
        "vendor:12": "Data vendor B belum lengkap: Lokasi",
        "vendor:3": "Data vendor A belum lengkap: Lokasi",
        "klien:9": "Data klien K belum lengkap: NPWP",
      },
    })
    expect(issues?.map((i) => `${i.kind}:${i.id}`)).toEqual(["client:9", "vendor:3", "vendor:12"])
  })

  it("keeps the client first when it already leads", () => {
    const issues = parseCompletenessIssues({
      fields: {
        "klien:9": "Data klien K belum lengkap: NPWP",
        "vendor:3": "Data vendor A belum lengkap: Lokasi",
      },
    })
    expect(issues?.map((i) => `${i.kind}:${i.id}`)).toEqual(["client:9", "vendor:3"])
  })

  it("puts shipping lines last, by line number", () => {
    const issues = parseCompletenessIssues({
      fields: {
        "baris:88": "Alamat pengiriman baris 3 belum diisi",
        "vendor:3": "Data vendor A belum lengkap: Lokasi",
        "baris:91": "Alamat pengiriman baris 1 belum diisi",
        "klien:9": "Data klien K belum lengkap: NPWP",
      },
    })
    expect(issues?.map((i) => `${i.kind}:${i.id}`)).toEqual([
      "client:9",
      "vendor:3",
      "line:1",
      "line:3",
    ])
  })

  it("returns null when fields is not an object", () => {
    expect(parseCompletenessIssues({ fields: "klien:1" })).toBeNull()
    expect(parseCompletenessIssues({ detail: "x" })).toBeNull()
  })
})
