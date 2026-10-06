import { ApiError } from "@/lib/api-client"
import type { QuotationItemRow } from "@/types/api"
import type { ProductItem } from "./wizard"

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

// Lines whose qty fails.
export function countInvalidQty(lines: { jumlah: number }[], allowZero = false): number {
  return lines.filter((l) => qtyIssue(l.jumlah, allowZero)).length
}

// PO lines may be 0.
//
// The PO edit server rule (validate.NonNegative) refuses only a negative or
// non-numeric qty, with this text.
export const PO_QTY_ERROR = "Jumlah harus berupa angka 0 atau lebih."

// Why a line's qty fails.
export function qtyIssue(qty: number, allowZero: boolean): string | undefined {
  if (!allowZero) return isValidQty(qty) ? undefined : QTY_ERROR
  return Number.isFinite(qty) && qty >= 0 ? undefined : PO_QTY_ERROR
}

// Line indexes from a 422.
//
// The server keys a line error as items[<i>].qty, where i is the position in
// the items array the wizard sent.
export function qtyErrorIndexes(err: unknown): Map<number, string> {
  const out = new Map<number, string>()
  if (!(err instanceof ApiError) || err.status !== 422) return out
  for (const [key, value] of Object.entries(err.body?.fields ?? {})) {
    const m = /^items\[(\d+)\]\.qty$/.exec(key)
    if (m) out.set(Number(m[1]), value)
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

// What a line still lacks.
// Mirrors the server's send rule (fn_change_quotation_status): a product, a
// vendor (linked, or picked to be linked on save), harga beli and harga
// jual. A Tidak Ditawarkan line needs none of them. A role that sets no
// price (pricing false) is not shown the harga jual a head fills in later.
export function lineGaps(p: ProductItem, pricing = true): string[] {
  if (p.noOffer) return []
  const gaps: string[] = []
  if (p.itemId === undefined) gaps.push("produk")
  if (p.vendorProductId === undefined && p.vendorId === undefined) gaps.push("vendor")
  if (!(p.hargaBeli > 0)) gaps.push("harga beli")
  if (pricing && !(p.hargaJual > 0)) gaps.push("harga jual")
  return gaps
}

// Ready to be sent.
export function isLineComplete(p: ProductItem, pricing = true): boolean {
  return lineGaps(p, pricing).length === 0
}

// Stored line, as the send rule reads it.
export type StoredLine = Pick<
  QuotationItemRow,
  | "itemType"
  | "isAvailable"
  | "offeredItemId"
  | "unitId"
  | "vendorProductId"
  | "costPrice"
  | "sellingPrice"
>

// Offered lines the send rule refuses.
// Mirrors fn_change_quotation_status: a product, a unit, a linked vendor,
// harga beli and harga jual above zero. Tidak Ditawarkan lines never count,
// and a harga jual hidden from the viewer is not theirs to fill.
export function incompleteLines(items: StoredLine[]): number {
  return items.filter(
    (it) =>
      it.itemType === "product" &&
      it.isAvailable &&
      (it.offeredItemId === undefined ||
        it.unitId === undefined ||
        it.vendorProductId === undefined ||
        !(Number(it.costPrice ?? 0) > 0) ||
        (it.sellingPrice !== undefined && !(Number(it.sellingPrice) > 0))),
  ).length
}
