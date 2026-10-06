import type { UnitRow } from "@/types/api"

// Units matching a typed query.
//
// Code or name, case-insensitive, first five. A blank query matches none:
// the picker only opens once something is typed.
export function matchUnits(units: readonly UnitRow[], query: string, limit = 5): UnitRow[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  return units
    .filter((u) => u.code.toLowerCase().includes(q) || (u.name ?? "").toLowerCase().includes(q))
    .slice(0, limit)
}

// Picker row label.
export function unitLabel(unit: UnitRow): string {
  return unit.name ? `${unit.code} - ${unit.name}` : unit.code
}
