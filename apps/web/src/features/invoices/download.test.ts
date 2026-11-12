import { beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "@/lib/api-client"
import { toast } from "@/lib/toast"
import { problem } from "@/test/problem"
import type { ProblemDetail } from "@/types/api"
import {
  coretaxRefusals,
  runCoretaxDownload,
  runDownload,
  safeFileName,
  transferErrorMessage,
} from "./download"

vi.mock("@/lib/toast", () => ({ toast: { error: vi.fn() } }))

beforeEach(() => vi.clearAllMocks())

describe("safeFileName", () => {
  it("replaces the slashes in invoice numbers", () => {
    expect(safeFileName("INV-00016/GNS/IX/2026")).toBe("INV-00016_GNS_IX_2026")
  })

  it("keeps dots, dashes and underscores", () => {
    expect(safeFileName("a_b-c.d")).toBe("a_b-c.d")
  })
})

describe("transferErrorMessage", () => {
  const fallback = "Gagal mengunduh PDF invoice."
  const detail = (status: number, d: string) => problem(status, { detail: d })
  const fields = problem(422, { fields: { paymentProofKey: "Unggah ulang." } })

  it.each<[string, unknown, string]>([
    ["English statusText on a 500", new ApiError(500, null, "Download failed: Internal"), fallback],
    ["404 detail in English", new ApiError(404, detail(404, "invoice not found"), "x"), fallback],
    [
      "409 detail",
      new ApiError(409, detail(409, "Invoice dibatalkan."), "x"),
      "Invoice dibatalkan.",
    ],
    [
      "422 detail",
      new ApiError(422, detail(422, "Data belum lengkap."), "x"),
      "Data belum lengkap.",
    ],
    ["422 blank detail", new ApiError(422, detail(422, "  "), "x"), fallback],
    ["422 field messages", new ApiError(422, fields, "x"), "Unggah ulang."],
    ["422 blank fields", new ApiError(422, problem(422, { fields: { a: "  " } }), "x"), fallback],
    ["422 title only", new ApiError(422, problem(422, { title: "Unprocessable" }), "x"), fallback],
    ["409 without a body", new ApiError(409, null, "Conflict"), fallback],
    ["network TypeError", new TypeError("Failed to fetch"), fallback],
  ])("%s", (_name, err, want) => {
    expect(transferErrorMessage(err, fallback)).toBe(want)
  })
})

describe("runDownload", () => {
  it("stays quiet when the download succeeds", async () => {
    const run = vi.fn(async () => {})
    await runDownload(run, "Gagal mengunduh invoice.")
    expect(run).toHaveBeenCalledTimes(1)
    expect(toast.error).not.toHaveBeenCalled()
  })

  it("toasts the user-facing 409 detail", async () => {
    const err = new ApiError(409, problem(409, { detail: "Invoice belum terbit." }), "Conflict")
    await runDownload(() => Promise.reject(err), "Gagal mengunduh invoice.")
    expect(toast.error).toHaveBeenCalledWith("Invoice belum terbit.")
  })

  it("toasts the fallback for an English failure", async () => {
    await runDownload(() => Promise.reject(new Error("Bad Gateway")), "Gagal mengunduh invoice.")
    expect(toast.error).toHaveBeenCalledWith("Gagal mengunduh invoice.")
  })
})

describe("Coretax refusals", () => {
  const row = {
    invoiceId: 4,
    quotationId: 104,
    invoiceNo: "INV-4",
    clientId: 9,
    clientName: "PT Laut",
    reason: "paid",
  } as const
  const refusal = (refused: unknown) =>
    new ApiError(
      422,
      {
        ...problem(422, { detail: "Ditolak.", code: "coretax_refused" }),
        refused,
      } as ProblemDetail,
      "Unprocessable",
    )

  it.each<[string, unknown, unknown]>([
    ["reads the rows", refusal([row]), [row]],
    ["needs rows", refusal([]), null],
    ["needs a list", refusal("x"), null],
    ["needs its code", new ApiError(422, problem(422, { detail: "x" }), "x"), null],
    ["needs a 422", new ApiError(409, problem(409, { code: "coretax_refused" }), "x"), null],
    ["ignores other errors", new Error("boom"), null],
  ])("%s", (_name, err, want) => {
    expect(coretaxRefusals(err)).toEqual(want)
  })

  it("hands the rows over instead of a toast", async () => {
    const onRefused = vi.fn()
    await runCoretaxDownload(() => Promise.reject(refusal([row])), "Gagal.", onRefused)
    expect(onRefused).toHaveBeenCalledWith([row])
    expect(toast.error).not.toHaveBeenCalled()
  })

  it("toasts any other failure", async () => {
    const onRefused = vi.fn()
    await runCoretaxDownload(() => Promise.reject(new Error("Bad Gateway")), "Gagal.", onRefused)
    expect(onRefused).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith("Gagal.")
  })

  it("stays quiet when the export succeeds", async () => {
    const onRefused = vi.fn()
    await runCoretaxDownload(async () => {}, "Gagal.", onRefused)
    expect(onRefused).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
  })
})
