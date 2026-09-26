import { beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "@/lib/api-client"
import { toast } from "@/lib/toast"
import { failureMessage, runDownload, safeFileName, transferErrorMessage } from "./download"

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
  const problem = (detail: string) => JSON.stringify({ title: "Conflict", detail })
  const fields = JSON.stringify({
    title: "Unprocessable",
    fields: { paymentProofKey: "Unggah ulang." },
  })

  it.each<[string, unknown, string]>([
    ["English statusText on a 500", new ApiError(500, "", "Download failed: Internal"), fallback],
    ["404 detail in English", new ApiError(404, problem("invoice not found"), "x"), fallback],
    [
      "409 text body",
      new ApiError(409, problem("Invoice dibatalkan."), "x"),
      "Invoice dibatalkan.",
    ],
    [
      "422 text body",
      new ApiError(422, problem("Data belum lengkap."), "x"),
      "Data belum lengkap.",
    ],
    ["422 parsed body", new ApiError(422, { detail: "NPWP kosong." }, "x"), "NPWP kosong."],
    ["422 field messages", new ApiError(422, fields, "x"), "Unggah ulang."],
    ["422 blank fields", new ApiError(422, { fields: { a: "  ", b: 3 } }, "x"), fallback],
    [
      "422 title only",
      new ApiError(422, JSON.stringify({ title: "Unprocessable" }), "x"),
      fallback,
    ],
    ["422 body that is not JSON", new ApiError(422, "<html>", "x"), fallback],
    ["network TypeError", new TypeError("Failed to fetch"), fallback],
  ])("%s", (_name, err, want) => {
    expect(transferErrorMessage(err, fallback)).toBe(want)
  })
})

describe("failureMessage", () => {
  const fallback = "Gagal mengunggah lampiran."

  it.each<[string, unknown, string]>([
    [
      "binary 409 detail",
      new ApiError(409, JSON.stringify({ detail: "Sudah ada." }), "x"),
      "Sudah ada.",
    ],
    ["binary 502 English", new ApiError(502, "", "Upload failed: Bad Gateway"), fallback],
    [
      "JSON call keeps its detail",
      new ApiError(422, { detail: "Tidak diizinkan." }, "Tidak diizinkan."),
      "Tidak diizinkan.",
    ],
    [
      "validation error text",
      new Error("Ukuran bukti pembayaran melebihi 20 MB."),
      "Ukuran bukti pembayaran melebihi 20 MB.",
    ],
  ])("%s", (_name, err, want) => {
    expect(failureMessage(err, fallback)).toBe(want)
  })
})

describe("transferErrorMessage odd bodies", () => {
  it.each<[string, unknown]>([
    ["JSON null", "null"],
    ["JSON string", '"Konflik"'],
    ["no body", null],
    ["number body", 409],
  ])("falls back on a 409 with %s", (_name, body) => {
    expect(transferErrorMessage(new ApiError(409, body, "Conflict"), "Gagal.")).toBe("Gagal.")
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
    const err = new ApiError(409, JSON.stringify({ detail: "Invoice belum terbit." }), "Conflict")
    await runDownload(() => Promise.reject(err), "Gagal mengunduh invoice.")
    expect(toast.error).toHaveBeenCalledWith("Invoice belum terbit.")
  })

  it("toasts the fallback for an English failure", async () => {
    await runDownload(() => Promise.reject(new Error("Bad Gateway")), "Gagal mengunduh invoice.")
    expect(toast.error).toHaveBeenCalledWith("Gagal mengunduh invoice.")
  })
})
