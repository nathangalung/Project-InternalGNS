import type { ContactChannels } from "@/features/clients/clientCard"
import { fromClientRow } from "@/features/clients/helpers"
import { clampPage, pageCount } from "@/lib/pagination"
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

// Client with the picked contact.
// The picker row carries the client's first contact; the summary must show
// the one the quotation will name, or none.
export function withContact(client: PickClient, contact: ContactChannels | undefined): PickClient {
  return {
    ...client,
    narahubung: contact?.name ?? "",
    phone: contact?.phone,
    email: contact?.email,
  }
}

// Contact the wizard selects.
// A pick still listed stays, so a list refresh never undoes the user's
// choice; otherwise the client's own contact, then the first listed. Before
// the list loads only the client's contact is known.
export function defaultContact(
  contacts: { id: number }[],
  current: number | undefined,
  clientContactId: number | undefined,
): number | undefined {
  const ids = contacts.map((c) => c.id)
  if (current !== undefined && ids.includes(current)) return current
  if (clientContactId !== undefined && ids.includes(clientContactId)) return clientContactId
  return contacts[0]?.id ?? clientContactId
}

// Clients per picker page.
export const PICKER_PAGE_SIZE = 10

// One picker page.
// The page is clamped into range; from and to are the 1-based rows shown,
// both 0 when there are none.
export function pickerWindow(total: number, page: number, size = PICKER_PAGE_SIZE) {
  const pages = pageCount(total, size)
  const current = clampPage(page, pages)
  const start = (current - 1) * size
  return {
    page: current,
    pages,
    start,
    from: total === 0 ? 0 : start + 1,
    to: Math.min(start + size, total),
  }
}
