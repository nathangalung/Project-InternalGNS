export function resolveRange(
  preset: string,
  startIso: string,
  endIso: string,
): { start: string; end: string } {
  if (preset === "kustom") return { start: startIso, end: endIso }
  if (preset === "semua") return { start: "", end: "" }
  const today = new Date()
  const end = today.toISOString().slice(0, 10)
  const start = new Date(today)
  if (preset === "7-hari") start.setDate(start.getDate() - 7)
  if (preset === "30-hari") start.setDate(start.getDate() - 30)
  return { start: start.toISOString().slice(0, 10), end }
}
