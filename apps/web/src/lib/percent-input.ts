// Percent typed the Indonesian way.
//
// A percent has no thousands grouping, so a comma or a dot starts the
// decimals, two at most, and a trailing % is allowed. The value is 0 to 100,
// kept as the plain decimal string the API takes ("2.5"), as
// validateDiscountPct and fn_update_po_items accept it.

// Same words as the API refusal.
export const PERCENT_ERROR = "Diskon harus berupa angka antara 0 dan 100."

export type PercentParse = { value: string | null } | { error: string }

// Typed text to the value.
// Blank is no value; anything else outside the rule is refused.
export function parsePercent(text: string): PercentParse {
  const t = text.trim().replace(/\s*%$/, "")
  if (t === "") return { value: null }
  const m = /^(\d{1,3})(?:[.,](\d{0,2}))?$/.exec(t)
  if (!m) return { error: PERCENT_ERROR }
  const n = Number(`${m[1]}.${m[2] || "0"}`)
  if (n > 100) return { error: PERCENT_ERROR }
  return { value: String(n) }
}

// Stored percent for the input.
// No discount shows empty.
export function percentShown(pct: number): string {
  return pct > 0 ? String(pct).replace(".", ",") : ""
}
