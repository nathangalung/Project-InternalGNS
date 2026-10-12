// IMPA code rules.
//
// Mirrors validate.IMPA in apps/api/internal/shared/validate, the source of
// truth; its testdata/impa_rules.json runs against both copies. A code is
// six digits. The forms people type (IMPA 190105, (190105), 19 01 05)
// reduce to them, and a blank or "-" is no code.

export const IMPA_ERROR =
  "Kode IMPA harus 6 digit angka, misalnya 190105. Kosongkan bila tidak ada."

// Shown where a product has no code.
export const NO_IMPA = "-"

// Hyphen, en dash and em dash, by code point: the shown placeholder.
const DASHES = new Set(["-", String.fromCharCode(0x2013), String.fromCharCode(0x2014)])
const MARK = /^IMPA\s*[:.#]?\s*/
const BODY = /^[0-9][0-9 .-]*[0-9]$/

// The six digits, "" for none or a bad code.
function reduce(raw: string): { code: string; ok: boolean } {
  const t = raw.trim()
  if ([...t].every((c) => DASHES.has(c))) return { code: "", ok: true }
  let u = t.toUpperCase()
  if (u.startsWith("(") && u.endsWith(")")) u = u.slice(1, -1).trim()
  u = u.replace(MARK, "")
  const digits = u.replace(/[^0-9]/g, "")
  return BODY.test(u) && digits.length === 6 ? { code: digits, ok: true } : { code: "", ok: false }
}

// The code as stored.
export function normalizeImpa(raw: string): string {
  return reduce(raw).code
}

// Optional code, checked once filled.
export function impaCodeError(raw: string): string | null {
  return reduce(raw).ok ? null : IMPA_ERROR
}

// A code for display.
export function impaLabel(code: string | null | undefined): string {
  const t = code?.trim()
  return t ? t : NO_IMPA
}
