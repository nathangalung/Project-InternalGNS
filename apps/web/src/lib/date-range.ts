// Business timezone, pinned DB session.
export const JAKARTA_TZ = "Asia/Jakarta"

export type DatePreset = "semua" | "hari-ini" | "7-hari" | "30-hari" | "kustom"

// Today in Jakarta, as YYYY-MM-DD.
export function todayInJakarta(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: JAKARTA_TZ }).format(new Date())
}

// Current year in Jakarta.
export function yearInJakarta(): number {
  return Number(todayInJakarta().slice(0, 4))
}

// Calendar day minus n days.
function minusDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}

// Kustom opens on the last 30 days.
const PRESET_DAYS: Record<string, number> = { "7-hari": 7, "30-hari": 30, kustom: 30 }

// Preset to WIB days.
//
// The server reads dateFrom and dateTo as inclusive WIB days, so the bounds
// are Jakarta calendar days, not the browser's own date or the UTC date
// toISOString gives before 07:00.
export function presetRange(preset: string): { start: string; end: string } {
  if (preset === "semua") return { start: "", end: "" }
  const end = todayInJakarta()
  return { start: minusDays(end, PRESET_DAYS[preset] ?? 0), end }
}

// Filter bounds for a list query.
//
// Kustom keeps the dates the user typed; every other preset is recomputed
// from today, so a saved preset never goes stale.
export function resolveRange(
  preset: string,
  startIso: string,
  endIso: string,
): { start: string; end: string } {
  if (preset === "kustom") return { start: startIso, end: endIso }
  return presetRange(preset)
}
