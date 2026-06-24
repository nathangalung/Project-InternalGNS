import type { ClientRow, VendorContactInfo, VendorRow } from "@/types/api"
import type { PoStatus } from "../types"

// PO status -> Indonesian label.
export const PO_LABEL: Record<PoStatus, string> = {
  PENDING: "Pending",
  UPLOADED: "PO Diunggah",
  ON_PROGRESS: "Dalam Progres",
  DELIVERED: "Dikirim",
}

// PO status visual tokens.
export const PO_STATUS_CONFIG: Record<PoStatus, { bg: string; color: string }> = {
  PENDING: { bg: "#FFE16D", color: "#DA6900" },
  UPLOADED: { bg: "#DBEAFE", color: "#1D4ED8" },
  ON_PROGRESS: { bg: "#CEC2FF", color: "#9333EA" },
  DELIVERED: { bg: "#D1FAE5", color: "#047857" },
}

export const PO_STATUS_ORDER: PoStatus[] = ["PENDING", "UPLOADED", "ON_PROGRESS", "DELIVERED"]

// Allowed manual transitions, mirroring fn_change_po_status. DELIVERED is
// terminal here: an invoice exists by then and the backend blocks reverting.
export const PO_TRANSITIONS: Record<PoStatus, PoStatus[]> = {
  PENDING: ["UPLOADED"],
  UPLOADED: ["ON_PROGRESS", "PENDING"],
  ON_PROGRESS: ["DELIVERED", "UPLOADED"],
  DELIVERED: [],
}

export function poNumberFromQuotationNo(no: string): string {
  if (no.startsWith("Q-")) return `PO-${no.slice(2)}`
  if (no.startsWith("Q")) return `PO-${no.slice(1)}`
  return `PO-${no}`
}

export function shortDocNo(no: string): string {
  const slash = no.indexOf("/")
  if (slash === -1) return no
  return `${no.slice(0, slash)}…`
}

function isFilled(v: string | undefined | null): boolean {
  return typeof v === "string" && v.trim().length > 0
}

function vendorContactField(
  contactInfo: VendorContactInfo | undefined,
  key: "email" | "phone",
): string {
  return contactInfo?.[key] ?? ""
}

export interface CompletenessIssue {
  scope: "Klien" | "Vendor"
  id: number
  name: string
  missing: string[]
}

// Check client + vendor completeness. Email/phone counted as one combined field.
export function validateClientCompleteness(client: ClientRow): string[] {
  const missing: string[] = []
  if (!isFilled(client.number)) missing.push("Nomor Klien")
  if (!isFilled(client.npwp)) missing.push("NPWP")
  if (!isFilled(client.address)) missing.push("Alamat")
  if (!isFilled(client.tkuId)) missing.push("Nomor TKU")
  if (!isFilled(client.contactName)) missing.push("Nama Narahubung")
  if (!isFilled(client.contactEmail) && !isFilled(client.contactPhone)) {
    missing.push("Email atau Nomor Telepon Narahubung")
  }
  return missing
}

export function validateVendorCompleteness(vendor: VendorRow): string[] {
  const missing: string[] = []
  if (!isFilled(vendor.location)) missing.push("Lokasi")
  const email = vendorContactField(vendor.contactInfo, "email")
  const phone = vendorContactField(vendor.contactInfo, "phone")
  if (!isFilled(email) && !isFilled(phone)) {
    missing.push("Email atau Nomor Telepon")
  }
  return missing
}
