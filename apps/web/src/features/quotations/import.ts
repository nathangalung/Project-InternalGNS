import { type UnitIndex, unitCode } from "@/features/units/match"
import type { LineRecommendation, MatchRowResult } from "@/types/api"
import { isLineComplete } from "./lines"
import type { ProductItem } from "./wizard"

// Number or zero.
function amount(v: string | undefined): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

// RFQ rows as wizard lines.
//
// A matched row starts from its recommendation (fn_recommend_lines): the
// vendor this client was last quoted with, else the cheapest active one, at
// that vendor's current harga beli, and the harga jual of the last deal.
// Anything without a recommendation stays at 0 with no vendor; the
// quotation saves as a draft and is completed before it is sent. A
// requested unit shows as the code it resolves to (Pieces as PCS).
export function importedLines(
  rows: MatchRowResult[],
  recs: LineRecommendation[],
  baseId: number,
  unitByText: UnitIndex = new Map(),
): ProductItem[] {
  const byItem = new Map(recs.map((r) => [r.itemId, r]))
  return rows.map((r, i) => {
    const m = r.matched
    const rec = m ? byItem.get(m.itemId) : undefined
    const requestedCode = r.requested.impaCode.toUpperCase()
    return {
      id: baseId + i + 1,
      itemId: m?.itemId,
      vendorId: rec?.vendorId,
      vendorProductId: rec?.vendorProductId,
      nama: m?.itemName ?? r.requested.name,
      kodeImpa: m?.impaCode ?? requestedCode,
      requestedNama: r.requested.name,
      requestedKodeImpa: requestedCode,
      vendor: rec?.vendorName ?? "",
      jumlah: r.requested.qty,
      satuan: m?.defaultUnitCode ?? unitCode(unitByText, r.requested.unit),
      hargaBeli: amount(rec?.costPrice),
      hargaJual: amount(rec?.sellingPrice),
    }
  })
}

// The import banner text.
export function importSummary(
  lines: ProductItem[],
  rows: MatchRowResult[],
  unknownUnits: number,
  pricing = true,
): string {
  const created = rows.filter((r) => r.source === "CREATED").length
  const matched = rows.filter((r) => r.matched && r.source !== "CREATED").length
  const pending = lines.filter((l) => !isLineComplete(l, pricing)).length
  const filled = lines.length - pending
  const fill = pending
    ? `${filled} terisi otomatis. ${pending} perlu vendor dan harga sebelum dikirim.`
    : "Semua terisi otomatis."
  const units = unknownUnits
    ? ` ${unknownUnits} produk perlu satuan yang dikenal. Pilih satuannya lewat tombol Ubah.`
    : ""
  return `${lines.length} produk diimpor (${matched} cocok dengan katalog, ${created} produk baru). ${fill}${units}`
}
