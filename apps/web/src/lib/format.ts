import { JAKARTA_TZ } from "@/lib/date-range"

// Figure not loaded yet.
//
// KPI cards show it until their summary arrives, or for good when it fails,
// so zero is never shown as data.
export const PENDING_FIGURE = "–"

// NaN-safe string/null → number coercion.
export function toNum(v: string | number | null | undefined): number {
  if (v == null || v === "") return 0
  const n = typeof v === "number" ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

// Rupiah, sen only when present.
//
// Tax figures such as DPP can carry sen. Those always print two digits
// ("Rp16.155.994,50"), never one or three; whole amounts print none.
export function formatRupiah(value: string | number | null | undefined, fallback = "Rp0"): string {
  if (value === null || value === undefined || value === "") return fallback
  const n = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(n) || n === 0) return fallback
  const sen = Math.round(n * 100) % 100 !== 0 ? 2 : 0
  return `Rp${n.toLocaleString("id-ID", { minimumFractionDigits: sen, maximumFractionDigits: sen })}`
}

export function formatNumber(value: number | string | null | undefined, fallback = "0"): string {
  if (value === null || value === undefined || value === "") return fallback
  const n = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  return n.toLocaleString("id-ID")
}

// Compact rupiah axis ticks.
export function formatRupiahAxis(v: number): string {
  if (v >= 1_000_000_000) return `Rp ${(v / 1_000_000_000).toFixed(0)}M`
  if (v >= 1_000_000) return `Rp ${(v / 1_000_000).toFixed(0)}Jt`
  if (v >= 1_000) return `Rp ${(v / 1_000).toFixed(0)}K`
  return `Rp ${v}`
}

// Parsed instant, or null.
function parseDate(iso: string): Date | null {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d
}

// Indonesian short date, in WIB.
//
// Document dates are WIB days. A date-only value parses as UTC midnight,
// which is 07:00 WIB on the same day, so formatting in Jakarta keeps its day
// in any browser zone; a timestamp lands on its WIB calendar day.
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return ""
  const d = parseDate(iso)
  if (!d) return iso
  return d.toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: JAKARTA_TZ,
  })
}

// Unpadded day, in WIB.
export function formatDateShort(iso: string | null | undefined): string {
  if (!iso) return ""
  const d = parseDate(iso)
  if (!d) return iso
  return d.toLocaleDateString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: JAKARTA_TZ,
  })
}

// Date plus hh:mm, in WIB.
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return ""
  const d = parseDate(iso)
  if (!d) return iso
  const time = d.toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: JAKARTA_TZ,
  })
  return `${formatDate(iso)}, ${time}`
}

// Rupiah in whole sen.
function toSen(rp: number): number {
  return Math.round(rp * 100)
}

// Integer division, half away from zero.
//
// Matches Postgres ROUND on numeric; operands are never negative here.
function divRound(a: bigint, b: bigint): bigint {
  const q = a / b
  return (a % b) * BigInt(2) >= b ? q + BigInt(1) : q
}

// Sum of rupiah amounts, in sen.
//
// Adds whole sen so two-decimal amounts never pick up float noise.
export function sumRupiah(values: number[]): number {
  return values.reduce((sum, v) => sum + toSen(v), 0) / 100
}

// One line's net, in rupiah.
//
// qty × price less discountPct, rounded to the sen the way
// quotation_items.subtotal and purchase_order_items.subtotal store it.
// Exact for the two-decimal inputs the API accepts.
export function lineNet(qty: number, price: number, discountPct = 0): number {
  const n = BigInt(toSen(qty)) * BigInt(toSen(price)) * BigInt(10_000 - toSen(discountPct))
  return Number(divRound(n, BigInt(1_000_000))) / 100
}

// Indonesian tax math, per line.
//
// Each line net (shipping is a line of its own) gives DPP Nilai Lain =
// ROUND(net × 11/12) and PPN = ROUND(that DPP × 12%), summed over the lines,
// as the server stores them for the quotation, the PO and the invoice.
export function computeTaxBreakdown(lineNets: number[]): {
  subtotal: number
  dppNilaiLain: number
  ppnAmount: number
  grandTotal: number
} {
  let net = 0
  let dpp = 0
  let ppn = 0
  for (const rp of lineNets) {
    const sen = toSen(rp)
    const lineDpp = divRound(BigInt(sen) * BigInt(11), BigInt(12))
    net += sen
    dpp += Number(lineDpp)
    ppn += Number(divRound(lineDpp * BigInt(12), BigInt(100)))
  }
  return {
    subtotal: net / 100,
    dppNilaiLain: dpp / 100,
    ppnAmount: ppn / 100,
    grandTotal: (net + ppn) / 100,
  }
}
