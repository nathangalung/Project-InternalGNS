import { describe, expect, it } from "vitest"
import { ApiError } from "@/lib/api-client"
import { isVersionConflict } from "@/lib/errors"
import { problem } from "@/test/problem"
import type { PoCompletenessIssue, PoIncompleteProblem, PurchaseOrderRow } from "@/types/api"
import {
  canDownloadDeliveryNote,
  completenessIssues,
  deliveryNoteFileName,
  isInvoiceFiled,
  isPoFileLocked,
  isPoLockRefusal,
  PO_CONFLICT_MESSAGE,
  PO_LABEL,
  PO_LOCKED_CODE,
  PO_NUMBER_MISSING,
  PO_NUMBER_REQUIRED_MESSAGE,
  PO_STATUS_CONFIG,
  PO_STATUS_ORDER,
  poBreakdown,
  poDetailsErrors,
  poEditLockReason,
  poErrorMessage,
  poNumberRequired,
  poRef,
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

describe("isPoFileLocked", () => {
  it.each([
    ["PENDING", false],
    ["UPLOADED", false],
    ["ON_PROGRESS", false],
    ["DELIVERED", true],
    ["CANCELLED", true],
  ] as const)("%s -> %s", (status, locked) => {
    expect(isPoFileLocked(status)).toBe(locked)
  })
})

describe("poEditLockReason", () => {
  it.each([
    ["PENDING", false, null],
    ["ON_PROGRESS", false, null],
    ["DELIVERED", false, null],
    [
      "DELIVERED",
      true,
      "PO yang sudah dikirim hanya dapat diubah setelah invoicenya dibatalkan dan sebelum invoice pengganti diterbitkan.",
    ],
    ["CANCELLED", true, "PO yang dibatalkan tidak dapat diubah."],
    ["UPLOADED", true, "PO ini tidak dapat diubah."],
  ] as const)("%s, locked %s", (status, linesLocked, reason) => {
    expect(poEditLockReason({ status, linesLocked })).toBe(reason)
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
    const err = new ApiError(
      409,
      problem(409, {
        code: "version_conflict",
        detail: "Data ini baru saja diubah pengguna lain. Muat ulang lalu coba lagi.",
      }),
      "Data ini baru saja diubah pengguna lain. Muat ulang lalu coba lagi.",
    )
    expect(poErrorMessage(err, "x")).toBe(PO_CONFLICT_MESSAGE)
  })

  it("keeps the lock 409 prose", () => {
    const msg = "Nomor dan tanggal PO tidak dapat diubah setelah invoice dikirim."
    const body = problem(409, { detail: msg, code: "po_locked" })
    expect(poErrorMessage(new ApiError(409, body, msg), "x")).toBe(msg)
  })

  it("falls back for an empty message", () => {
    expect(poErrorMessage(new ApiError(500, null, ""), "Gagal.")).toBe("Gagal.")
  })
})

describe("409 classification", () => {
  const lockBody = problem(409, { detail: "Berkas PO tidak dapat diubah.", code: "po_locked" })
  const versionBody = problem(409, {
    detail: "Data ini baru saja diubah pengguna lain. Muat ulang lalu coba lagi.",
    code: "version_conflict",
  })
  it.each([
    ["lock with code", new ApiError(409, lockBody, "Berkas PO tidak dapat diubah."), true, false],
    ["stale version", new ApiError(409, versionBody, "x"), false, true],
    [
      "untagged 409 naming row_version",
      new ApiError(409, null, "row_version mismatch"),
      false,
      false,
    ],
    ["409 without code or version", new ApiError(409, null, "Konflik."), false, false],
    ["other code", new ApiError(409, problem(409, { code: "other" }), "Konflik."), false, false],
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

describe("completenessIssues", () => {
  const issues: PoCompletenessIssue[] = [
    {
      kind: "client",
      id: 4,
      name: "PT Samudra, Tbk",
      message: "Data klien PT Samudra, Tbk belum lengkap: Narahubung aktif",
      missing: [{ code: "contact_inactive", label: "Narahubung aktif" }],
    },
    {
      kind: "shipping",
      id: 57,
      message: "Alamat pengiriman belum diisi",
      missing: [{ code: "shipping_address", label: "Alamat Pengiriman" }],
    },
  ]
  const gate = problem(422, { code: "po_incomplete", detail: "…" })
  const body: PoIncompleteProblem = { ...gate, issues }

  it("reads the gate's typed issues in server order", () => {
    const err = new ApiError(422, body, "…")
    expect(completenessIssues(err)).toEqual(issues)
  })

  it.each<[string, unknown]>([
    ["another 422", new ApiError(422, problem(422, { fields: { status: "x" } }), "x")],
    ["the code without issues", new ApiError(422, gate, "…")],
    ["the gate code on another status", new ApiError(409, body, "…")],
    ["no body", new ApiError(422, null, "x")],
    ["an empty issue list", new ApiError(422, { ...body, issues: [] } as PoIncompleteProblem, "…")],
    ["a plain Error", new Error("x")],
  ])("ignores %s", (_name, err) => {
    expect(completenessIssues(err)).toBeNull()
  })
})

describe("shortDocNo", () => {
  it.each<[string, string]>([
    ["Q-00011/GNS/X/2026", "Q-00011…"],
    ["PO-77", "PO-77"],
    ["/GNS", "…"],
  ])("%s -> %s", (no, want) => {
    expect(shortDocNo(no)).toBe(want)
  })
})

describe("PO number", () => {
  it("names a PO by its number, else by its quotation", () => {
    expect(poRef({ poNumber: "PO/KLIEN/7", quotationNo: "Q-00011/GNS/X/2026" })).toBe("PO/KLIEN/7")
    expect(poRef({ quotationNo: "Q-00011/GNS/X/2026" })).toBe("PO dari Q-00011/GNS/X/2026")
    expect(PO_NUMBER_MISSING).toBe("Belum ada No. PO")
  })

  // Mirrors fn_update_po_details.
  it.each<[PurchaseOrderRow["status"], boolean]>([
    ["PENDING", false],
    ["UPLOADED", false],
    ["ON_PROGRESS", true],
    ["DELIVERED", true],
    ["CANCELLED", false],
  ])("%s requires the number: %s", (status, want) => {
    expect(poNumberRequired(status)).toBe(want)
  })

  it("puts a details refusal on its fields", () => {
    const err = new ApiError(
      422,
      problem(422, {
        fields: { poNumber: PO_NUMBER_REQUIRED_MESSAGE, poDate: "must be YYYY-MM-DD", other: "x" },
      }),
      "Unprocessable",
    )
    expect(poDetailsErrors(err)).toEqual({
      fields: { poNumber: PO_NUMBER_REQUIRED_MESSAGE, poDate: "must be YYYY-MM-DD" },
      banner: "x",
    })
  })

  it.each<[string, unknown]>([
    ["a conflict", new ApiError(409, problem(409), "Conflict")],
    ["a plain error", new Error("boom")],
  ])("leaves %s to the toast", (_name, err) => {
    expect(poDetailsErrors(err)).toBeNull()
  })
})
