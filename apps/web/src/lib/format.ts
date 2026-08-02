// NaN-safe string/null → number coercion.
export function toNum(v: string | number | null | undefined): number {
  if (v == null || v === "") return 0
  const n = typeof v === "number" ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

// Currency + number formatters.
export function formatRupiah(value: string | number | null | undefined, fallback = "Rp0"): string {
  if (value === null || value === undefined || value === "") return fallback
  const n = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(n) || n === 0) return fallback
  return `Rp${n.toLocaleString("id-ID")}`
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

// Indonesian short date display.
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return ""
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })
}

// Date plus hh:mm time.
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return ""
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const date = d.toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })
  const time = d.toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
  })
  return `${date}, ${time}`
}

// Indonesian tax math: 11/12 base, 12% PPN. The taxable base always includes
// shipping, matching the DB GENERATED columns ((total - discount) where total
// folds in shipping). subtotal here is products minus discount.
export function computeTaxBreakdown(input: { subtotal: number; shipping: number }): {
  dppNilaiLain: number
  ppnAmount: number
  grandTotal: number
} {
  const dppBase = input.subtotal + input.shipping
  const dppNilaiLain = Math.round((dppBase * 11) / 12)
  const ppnAmount = Math.round(dppNilaiLain * 0.12)
  const grandTotal = dppBase + ppnAmount
  return { dppNilaiLain, ppnAmount, grandTotal }
}
