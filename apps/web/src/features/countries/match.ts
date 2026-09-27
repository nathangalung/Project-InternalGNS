import type { CountryRow } from "@/types/api"

// Countries matching a typed query.
//
// Name or code, case-insensitive, first five; a blank query keeps the head
// of the list for the pickers that open before anything is typed.
export function matchCountries(
  countries: readonly CountryRow[],
  query: string,
  limit = 5,
): CountryRow[] {
  const q = query.trim().toLowerCase()
  return countries
    .filter((c) => !q || c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q))
    .slice(0, limit)
}
