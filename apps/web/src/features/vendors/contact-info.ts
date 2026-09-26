import type { VendorContactInfo } from "@/types/api"

// Next contact_info for an update.
//
// The API replaces contact_info wholesale, so other keys (sku) are carried
// over and an emptied email or phone is removed rather than kept. An empty
// object is sent rather than nothing, so clearing both always lands.
export function buildContactInfo(
  prev: VendorContactInfo | null | undefined,
  email: string,
  phone: string,
): VendorContactInfo {
  const next: VendorContactInfo = { ...prev }
  const e = email.trim()
  const p = phone.trim()
  if (e) next.email = e
  else delete next.email
  if (p) next.phone = p
  else delete next.phone
  return next
}
