// Business timezone, matching the pinned DB session.
const JAKARTA_TZ = "Asia/Jakarta"

// Today in Jakarta, as YYYY-MM-DD.
export function todayInJakarta(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: JAKARTA_TZ }).format(new Date())
}

// Calendar day minus n days.
function minusDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}

const PRESET_DAYS: Record<string, number> = { "7-hari": 7, "30-hari": 30 }

// Preset to a WIB day range.
//
// The server reads dateFrom and dateTo as inclusive WIB days, so the bounds
// are Jakarta calendar days, not the UTC date toISOString gives before 07:00.
export function resolveRange(
  preset: string,
  startIso: string,
  endIso: string,
): { start: string; end: string } {
  if (preset === "kustom") return { start: startIso, end: endIso }
  if (preset === "semua") return { start: "", end: "" }
  const end = todayInJakarta()
  return { start: minusDays(end, PRESET_DAYS[preset] ?? 0), end }
}
