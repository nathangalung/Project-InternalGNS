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

describe("validateAsset per kind", () => {
  it.each<[AssetKind, string, number]>([
    ["clientLogo", "logo klien", 2],
    ["vendorLogo", "logo vendor", 2],
    ["itemImage", "gambar produk", 5],
    ["poDoc", "dokumen PO", 20],
  ])("%s caps at its own size", (kind, label, mb) => {
    const ext = kind === "poDoc" ? "a.pdf" : "a.png"
    const type = kind === "poDoc" ? "application/pdf" : "image/png"
    expect(() => validateAsset(kind, file(ext, mb * MB, type))).not.toThrow()
    expect(() => validateAsset(kind, file(ext, mb * MB + 1, type))).toThrow(
      `Ukuran ${label} melebihi ${mb} MB.`,
    )
  })

  it("refuses a PDF as a logo", () => {
    expect(() => validateAsset("clientLogo", file("logo.pdf", 10, "application/pdf"))).toThrow(
      "Format logo klien tidak didukung. Gunakan: .png, .jpg, .jpeg, .webp, .gif.",
    )
  })

  it("refuses a file with no extension", () => {
    expect(() => validateAsset("poDoc", file("scan", 10, "application/pdf"))).toThrow(
      "Format dokumen PO tidak didukung.",
    )
  })

  it("refuses an image MIME dressed as a logo it is not", () => {
    expect(() => validateAsset("vendorLogo", file("a.png", 10, "image/svg+xml"))).toThrow(
      "Tipe file logo vendor tidak didukung.",
    )
  })
})
