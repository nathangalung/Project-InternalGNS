// Currency + number formatters.
export function formatRupiah(
  value: string | number | null | undefined,
  fallback = "Rp0",
): string {
  if (value === null || value === undefined || value === "") return fallback
  const n = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(n) || n === 0) return fallback
  return "Rp" + n.toLocaleString("id-ID")
}

export function formatNumber(
  value: number | string | null | undefined,
  fallback = "0",
): string {
  if (value === null || value === undefined || value === "") return fallback
  const n = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  return n.toLocaleString("id-ID")
}
