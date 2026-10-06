import type { ClientInfo } from "@/features/quotations/types"
import type { ClientRow, ContactRow } from "@/types/api"

// One contact's own channels.
export type ContactChannels = { name?: string; email?: string; phone?: string }

// Client card from live data.
//
// The legal fields come from the client; the narahubung, phone and email
// only from the document's own contact. A contact without an email shows
// none: the company email or the client's first contact would put another
// person's address beside this name.
export function clientCardInfo(
  base: ClientInfo,
  client: ClientRow | undefined,
  contact: ContactChannels | undefined,
): ClientInfo {
  return {
    ...base,
    narahubung: base.narahubung ?? contact?.name,
    phone: contact?.phone,
    email: contact?.email,
    nomorTKU: client?.tkuId,
    npwp: client?.npwp,
    lokasi: client?.address,
  }
}

// The chosen contact, if listed.
export function pickedContact(
  contacts: ContactRow[] | undefined,
  contactId: number | undefined,
): ContactChannels | undefined {
  const c = contactId === undefined ? undefined : contacts?.find((r) => r.id === contactId)
  return c ? { name: c.name, email: c.email, phone: c.phone } : undefined
}

// The document's stored contact.
// Read by id on the server, so a deactivated contact keeps its channels.
export function documentContact(d: {
  contactId?: number
  contactEmail?: string
  contactPhone?: string
}): ContactChannels | undefined {
  return d.contactId === undefined ? undefined : { email: d.contactEmail, phone: d.contactPhone }
}
