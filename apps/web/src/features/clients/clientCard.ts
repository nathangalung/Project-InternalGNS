import type { ClientInfo } from "@/features/quotations/types"
import type { ClientRow, ContactRow } from "@/types/api"

// Client card from live data.
//
// Quotation and PO payloads carry only the contact name, so the card reads
// the rest from the client and the document's own contact. With no contact
// on the document, the client's primary contact stands in; a contact that
// is no longer listed never borrows another person's phone or email.
export function clientCardInfo(
  base: ClientInfo,
  client: ClientRow | undefined,
  contacts: ContactRow[] | undefined,
  contactId: number | undefined,
): ClientInfo {
  const primary = contactId === undefined
  const contact = primary ? undefined : contacts?.find((c) => c.id === contactId)
  return {
    ...base,
    narahubung: base.narahubung ?? (primary ? client?.contactName : contact?.name),
    phone: primary ? client?.contactPhone : contact?.phone,
    email: (primary ? client?.contactEmail : contact?.email) ?? client?.email,
    nomorTKU: client?.tkuId,
    npwp: client?.npwp,
    lokasi: client?.address,
  }
}
