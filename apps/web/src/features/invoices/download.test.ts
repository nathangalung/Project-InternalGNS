import { describe, expect, it } from "vitest"
import { ApiError } from "@/lib/api-client"
import { safeFileName, transferErrorMessage } from "./download"

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
