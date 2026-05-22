// Per-asset upload policy.
export type AssetKind = "clientLogo" | "vendorLogo" | "itemImage" | "invoiceAttachment" | "poDoc"

type Policy = {
  maxBytes: number
  mimeTypes: ReadonlySet<string>
  extensions: ReadonlySet<string>
  label: string
}

const IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"])
const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"])
const DOC_MIMES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
])
const DOC_EXTS = new Set([".pdf", ".png", ".jpg", ".jpeg", ".webp", ".xlsx", ".xls"])

const MB = 1024 * 1024

// Asset policy table.
const POLICIES: Record<AssetKind, Policy> = {
  clientLogo: {
    maxBytes: 2 * MB,
    mimeTypes: IMAGE_MIMES,
    extensions: IMAGE_EXTS,
    label: "logo klien",
  },
  vendorLogo: {
    maxBytes: 2 * MB,
    mimeTypes: IMAGE_MIMES,
    extensions: IMAGE_EXTS,
    label: "logo vendor",
  },
  itemImage: {
    maxBytes: 5 * MB,
    mimeTypes: IMAGE_MIMES,
    extensions: IMAGE_EXTS,
    label: "gambar produk",
  },
  invoiceAttachment: {
    maxBytes: 20 * MB,
    mimeTypes: DOC_MIMES,
    extensions: DOC_EXTS,
    label: "lampiran invoice",
  },
  poDoc: { maxBytes: 20 * MB, mimeTypes: DOC_MIMES, extensions: DOC_EXTS, label: "dokumen PO" },
}

function extOf(name: string): string {
  const i = name.lastIndexOf(".")
  return i < 0 ? "" : name.slice(i).toLowerCase()
}

function fmtMB(bytes: number): string {
  return `${Math.round((bytes / MB) * 10) / 10} MB`
}

// Throws Error on violation.
export function validateAsset(kind: AssetKind, file: File): void {
  const policy = POLICIES[kind]
  if (file.size <= 0) {
    throw new Error(`File ${policy.label} kosong.`)
  }
  if (file.size > policy.maxBytes) {
    throw new Error(`Ukuran ${policy.label} melebihi ${fmtMB(policy.maxBytes)}.`)
  }
  const ext = extOf(file.name)
  if (!policy.extensions.has(ext)) {
    const allowed = Array.from(policy.extensions).join(", ")
    throw new Error(`Format ${policy.label} tidak didukung. Gunakan: ${allowed}.`)
  }
  // Treat empty MIME as octet-stream; rely on extension allowlist.
  if (file.type && !policy.mimeTypes.has(file.type)) {
    throw new Error(`Tipe file ${policy.label} tidak didukung.`)
  }
}
