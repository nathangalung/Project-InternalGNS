import type { UnitRow } from "@/types/api"

// Unit text as stored.
//
// Upper case, one space between words and no trailing dot, as
// fn_unit_text stores an alias, so "pcs." and "PCS" are one text.
export function normalizeUnitText(text: string): string {
  return text.toUpperCase().replace(/\s+/g, " ").trim().replace(/\.+$/, "").trim()
}

// Units by code and alias.
export type UnitIndex = Map<string, UnitRow>

// Index every code and alias.
//
// The database keeps an alias from ever equalling a code; a code still
// wins here so a stale list cannot shadow one.
export function unitIndex(units: readonly UnitRow[] | undefined): UnitIndex {
  const index: UnitIndex = new Map()
  for (const u of units ?? []) {
    for (const alias of u.aliases) index.set(normalizeUnitText(alias), u)
  }
  for (const u of units ?? []) index.set(normalizeUnitText(u.code), u)
  return index
}

// The unit a text names.
export function resolveUnit(index: UnitIndex, text: string): UnitRow | undefined {
  return index.get(normalizeUnitText(text))
}

// Printed code for a text.
// An unknown text stays as typed, upper-cased, for the user to fix.
export function unitCode(index: UnitIndex, text: string): string {
  return resolveUnit(index, text)?.code ?? text.trim().toUpperCase()
}

// Alias a query hit.
// Only when neither the code nor the name already shows the match.
function aliasHit(unit: UnitRow, q: string): string | undefined {
  if (unit.code.toUpperCase().includes(q) || (unit.name ?? "").toUpperCase().includes(q)) {
    return undefined
  }
  return unit.aliases.find((a) => a === q) ?? unit.aliases.find((a) => a.includes(q))
}

function matches(unit: UnitRow, q: string): boolean {
  return (
    unit.code.toUpperCase().includes(q) ||
    (unit.name ?? "").toUpperCase().includes(q) ||
    unit.aliases.some((a) => a.includes(q))
  )
}

function exact(unit: UnitRow, q: string): boolean {
  return unit.code.toUpperCase() === q || unit.aliases.includes(q)
}

// Units matching a typed query.
//
// Code, name or alias, case-insensitive, first five, the unit the query
// names exactly first. A blank query matches none: the picker only opens
// once something is typed.
export function matchUnits(units: readonly UnitRow[], query: string, limit = 5): UnitRow[] {
  const q = normalizeUnitText(query)
  if (!q) return []
  const hits = units.filter((u) => matches(u, q))
  return [...hits.filter((u) => exact(u, q)), ...hits.filter((u) => !exact(u, q))].slice(0, limit)
}

// Picker row label.
export function unitLabel(unit: UnitRow): string {
  return unit.name ? `${unit.code} - ${unit.name}` : unit.code
}

// Picker row for a query.
// A row found by its alias names that alias, so the pick is clear.
export function unitOption(unit: UnitRow, query: string): string {
  const q = normalizeUnitText(query)
  const alias = q ? aliasHit(unit, q) : undefined
  return alias ? `${unitLabel(unit)} (${alias})` : unitLabel(unit)
}
