import { type FormErrors, formErrors } from "@/lib/form-errors"
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

export type VendorFormField = "name" | "phone" | "email"

// API field keys by input.
const SERVER_KEYS = {
  name: "name",
  phone: "contactInfo.phone",
  email: "contactInfo.email",
} as const

// Split a vendor save error.
//
// The API names contact fields by their request path, so they are moved
// onto the phone and email inputs; anything else goes to the banner.
export function vendorFormErrors(err: unknown, fallback: string): FormErrors<VendorFormField> {
  const split = formErrors(err, Object.values(SERVER_KEYS), fallback)
  const fields: Partial<Record<VendorFormField, string>> = {}
  for (const field of Object.keys(SERVER_KEYS) as VendorFormField[]) {
    const msg = split.fields[SERVER_KEYS[field]]
    if (msg) fields[field] = msg
  }
  return { fields, banner: split.banner }
}
