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
