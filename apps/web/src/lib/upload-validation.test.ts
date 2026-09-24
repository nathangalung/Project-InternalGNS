import { describe, expect, it } from "vitest"
import { type AssetKind, validateAsset } from "./upload-validation"

const MB = 1024 * 1024

function file(name: string, size: number, type: string): File {
  return new File([new Uint8Array(size)], name, { type })
}

describe("validateAsset", () => {
  it.each<[string, AssetKind, File, string]>([
    ["empty proof", "paymentProof", file("a.pdf", 0, "application/pdf"), "bukti pembayaran kosong"],
    [
      "oversize proof",
      "paymentProof",
      file("a.pdf", 20 * MB + 1, "application/pdf"),
      "Ukuran bukti pembayaran melebihi 20 MB.",
    ],
    [
      "proof extension",
      "paymentProof",
      file("a.exe", 10, "application/pdf"),
      "Format bukti pembayaran tidak didukung.",
    ],
    [
      "proof MIME",
      "paymentProof",
      file("a.pdf", 10, "text/html"),
      "Tipe file bukti pembayaran tidak didukung.",
    ],
    [
      "attachment keeps its label",
      "invoiceAttachment",
      file("a.exe", 10, "application/pdf"),
      "Format lampiran invoice tidak didukung.",
    ],
  ])("%s", (_name, kind, f, want) => {
    expect(() => validateAsset(kind, f)).toThrow(want)
  })

  it.each<[string, File]>([
    ["PDF", file("bukti.pdf", 10, "application/pdf")],
    ["image without MIME", file("bukti.JPG", 10, "")],
    ["Excel at the cap", file("bukti.xlsx", 20 * MB, "application/vnd.ms-excel")],
  ])("accepts a proof: %s", (_name, f) => {
    expect(() => validateAsset("paymentProof", f)).not.toThrow()
  })
})
