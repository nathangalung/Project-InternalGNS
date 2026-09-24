import { fromClientRow } from "@/features/clients/helpers"
import type { ClientRow } from "@/types/api"
import type { Client } from "./Step1Client"

export type PickClient = Client & { contactId?: number }

// Selected client, listed or fetched.
//
// The picker holds only the first page or a search result, so a client made
// inside the wizard, or one scrolled out by a new search, is in neither. Its
// own row then fills in, so the reference number and Step 4 card survive.
export function resolveClient(
  listed: PickClient[],
  selectedId: string,
  row: ClientRow | undefined,
): PickClient | undefined {
  if (!selectedId) return undefined
  const hit = listed.find((c) => c.id === selectedId)
  if (hit) return hit
  return row && String(row.id) === selectedId ? fromClientRow(row) : undefined
}

// Picker rows, selection kept visible.
export function visibleClients(
  sorted: PickClient[],
  selected: PickClient | undefined,
  limit: number,
): PickClient[] {
  const top = sorted.slice(0, limit)
  if (!selected || top.some((c) => c.id === selected.id)) return top
  return [selected, ...top.slice(0, limit - 1)]
}
