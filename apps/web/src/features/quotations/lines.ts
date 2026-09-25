import { ApiError } from "@/lib/api-client"
import type { ProductItem } from "./QuotationEdit"

// Wizard line quantity rules.
//
// The server refuses a line whose qty is not above zero, so the wizard
// blocks it first and names the card instead of failing the whole save.
export const QTY_ERROR = "Jumlah harus lebih dari 0."

// Raw form value to quantity.
export function parseQty(raw: string | number | undefined): number {
  const n = Number(raw)
  return Number.isFinite(n) ? n : 0
}

export function isValidQty(qty: number): boolean {
  return Number.isFinite(qty) && qty > 0
}

export function countInvalidQty(lines: { jumlah: number }[]): number {
  return lines.filter((l) => !isValidQty(l.jumlah)).length
}

// Line indexes from a 422.
//
// The server keys a line error as items[<i>].qty, where i is the position in
// the items array the wizard sent.
export function qtyErrorIndexes(err: unknown): Map<number, string> {
  const out = new Map<number, string>()
  if (!(err instanceof ApiError) || err.status !== 422) return out
  const body = err.body
  if (!body || typeof body !== "object" || !("fields" in body)) return out
  const fields = body.fields
  if (!fields || typeof fields !== "object") return out
  for (const [key, value] of Object.entries(fields)) {
    const m = /^items\[(\d+)\]\.qty$/.exec(key)
    if (m && typeof value === "string") out.set(Number(m[1]), value)
  }
  return out
}

// Index errors to card ids.
export function qtyErrorsById(
  lines: { id: number }[],
  byIndex: Map<number, string>,
): Record<number, string> {
  const out: Record<number, string> = {}
  for (const [i, msg] of byIndex) {
    const line = lines[i]
    if (line) out[line.id] = msg
  }
  return out
}

type RequestLine = Pick<
  ProductItem,
  "itemId" | "kodeImpa" | "nama" | "requestedKodeImpa" | "requestedNama"
>

// Request IMPA a line saves.
//
// A catalog offer carries its own code, so a request without one stays
// without one; the PDF prints this column as the client's words. A free-text
// offer has nowhere else to keep its code, so it rides on the request, which
// is where fn_create_purchase_order looks when no catalog item is linked.
export function requestedCode(p: RequestLine): string {
  return p.requestedKodeImpa || (p.itemId === undefined ? p.kodeImpa : "")
}

// Request differs from the offer.
//
// Mirrors the detail table: a request with no code does not differ on code.
export function requestDiffers(p: RequestLine): boolean {
  const kode = requestedCode(p)
  const nama = p.requestedNama || p.nama
  return nama !== p.nama || (kode !== "" && kode !== p.kodeImpa)
}
