import { toNum } from "@/lib/format"

// YYYY-MM → 0-based month index for the given year; -1 if different year.
export function mapToMonthIndex(month: string, baseYear: number): number {
  const [y, m] = month.split("-").map(Number)
  if (y !== baseYear) return -1
  return m - 1
}

export function buildSeries(
  points: { month: string; value: string }[] | undefined,
  baseYear: number,
): number[] {
  const series = new Array<number>(12).fill(0)
  if (!points) return series
  for (const p of points) {
    const idx = mapToMonthIndex(p.month, baseYear)
    if (idx >= 0 && idx < series.length) series[idx] = toNum(p.value)
  }
  return series
}

// Day count of a 0-based month.
export function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate()
}

// Day-of-month labels "1".."N".
export function dayLabels(year: number, month: number): string[] {
  return Array.from({ length: daysInMonth(year, month) }, (_, i) => String(i + 1))
}

// YYYY-MM-DD daily buckets into a day-indexed array for one month.
export function buildDailySeries(
  points: { month: string; value: string }[] | undefined,
  year: number,
  month: number,
): number[] {
  const n = daysInMonth(year, month)
  const series = new Array<number>(n).fill(0)
  if (!points) return series
  const prefix = `${year}-${String(month + 1).padStart(2, "0")}-`
  for (const p of points) {
    if (!p.month.startsWith(prefix)) continue
    const day = Number(p.month.slice(prefix.length))
    if (day >= 1 && day <= n) series[day - 1] = toNum(p.value)
  }
  return series
}

// Inclusive-from, exclusive-to spanning a full year.
export function yearRange(year: number): { from: string; to: string } {
  return { from: `${year}-01-01`, to: `${year + 1}-01-01` }
}

// Inclusive-from, exclusive-to spanning one 0-based month.
export function monthRange(year: number, month: number): { from: string; to: string } {
  const mm = String(month + 1).padStart(2, "0")
  const from = `${year}-${mm}-01`
  const to = month === 11 ? `${year + 1}-01-01` : `${year}-${String(month + 2).padStart(2, "0")}-01`
  return { from, to }
}
