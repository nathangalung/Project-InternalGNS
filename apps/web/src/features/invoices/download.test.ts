import { beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "@/lib/api-client"
import { toast } from "@/lib/toast"
import { problem } from "@/test/problem"
import { runDownload, safeFileName, transferErrorMessage } from "./download"

vi.mock("@/lib/toast", () => ({ toast: { error: vi.fn() } }))

beforeEach(() => vi.clearAllMocks())

describe("safeFileName", () => {
  it("replaces the slashes in invoice numbers", () => {
    expect(safeFileName("INV-2640016/GNS/IX/2026")).toBe("INV-2640016_GNS_IX_2026")
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
