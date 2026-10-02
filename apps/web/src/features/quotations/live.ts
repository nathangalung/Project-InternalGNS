import type { QuotationDetail, QuotationEditLock, QuotationHeaderInput } from "@/types/api"

// Live edit parts and claims.
//
// A draft is edited in parts: the header (shipping, terms, discount) and
// each line. One user holds a part at a time; the server names the parts in
// detail.locks.

export const HEADER_PART = "header"

export function linePart(lineId: number): string {
  return `line:${lineId}`
}

// Parts other users hold.
//
// Lines are keyed by line id and the header carries the holder's name, so
// the page can show who is editing what. The caller's own claims are left
// out: those parts stay editable for them.
export type LockOwners = {
  lines: Record<number, string>
  header?: string
}

export function lockOwners(locks: QuotationEditLock[], meId: number | undefined): LockOwners {
  const owners: LockOwners = { lines: {} }
  for (const l of locks) {
    if (l.userId === meId) continue
    if (l.part === HEADER_PART) {
      owners.header = l.userName
      continue
    }
    const id = Number(l.part.slice("line:".length))
    if (l.part.startsWith("line:") && Number.isInteger(id)) owners.lines[id] = l.userName
  }
  return owners
}

// When the next claim lapses.
//
// An expired claim sends no notice, so the page reloads at the earliest
// expiry of another user's claim; undefined when there is none.
export function nextExpiry(
  locks: QuotationEditLock[],
  meId: number | undefined,
): number | undefined {
  let next: number | undefined
  for (const l of locks) {
    if (l.userId === meId) continue
    const at = Date.parse(l.expiresAt)
    if (Number.isFinite(at) && (next === undefined || at < next)) next = at
  }
  return next
}

// Header fields the wizard edits.
export type HeaderFields = {
  discountPct: number
  shippingAddress: string
  shippingTime: string
  shippingCost: string
  jatuhTempo: string
  berlakuSampai: string
}

// Full header save body.
//
// The save replaces every header field: an absent shipping address drops
// the shipping line and an absent note clears it. Fields the wizard does
// not edit are sent back from the stored quotation.
export function headerInput(d: QuotationDetail, h: HeaderFields): QuotationHeaderInput {
  const shipDays = Number(h.shippingTime)
  const validity = Number(h.berlakuSampai)
  const terms = h.jatuhTempo.trim()
  return {
    clientRefNo: d.clientRefNo ?? undefined,
    vesselName: d.vesselName ?? undefined,
    notes: d.notes ?? undefined,
    paymentTerms: terms ? `${terms} days` : undefined,
    validityDays: validity > 0 ? validity : undefined,
    discountPct: String(h.discountPct),
    shippingAddress: h.shippingAddress || undefined,
    shippingDays: Number.isFinite(shipDays) && shipDays > 0 ? shipDays : undefined,
    shippingCost: h.shippingCost || undefined,
  }
}

// The steps of one Simpan.
//
// contactId is set only when the user picked another contact.
export type DraftSave = {
  holdsHeader: boolean
  contactId?: number
  acquireHeader: () => Promise<boolean>
  releaseHeader: () => Promise<void>
  saveHeader: () => Promise<unknown>
  saveContact: (contactId: number) => Promise<unknown>
}

// Save the header, then the contact.
//
// The contact is part of the header, so a changed one is sent while this
// user holds the header, claimed here when the header steps did not. True
// when everything saved; on a refusal a claim taken here is freed, while a
// claim held before stays for the next try.
export async function saveDraft(s: DraftSave): Promise<boolean> {
  const claim = s.contactId !== undefined && !s.holdsHeader
  if (claim && !(await s.acquireHeader())) return false
  try {
    if (s.holdsHeader) await s.saveHeader()
    if (s.contactId !== undefined) await s.saveContact(s.contactId)
  } catch {
    if (claim) void s.releaseHeader()
    return false
  }
  return true
}
