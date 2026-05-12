import type { Client } from "@/features/quotations/Step1Client"
import type { ClientRow, ClientSearchHit } from "@/types/api"

// Two-letter avatar initials. Strips a leading "PT" / "PT." prefix
// since most local company names start with it.
export function getCompanyInitials(name: string): string {
  const parts = name
    .replace(/^PT\.?\s+/i, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (parts.length === 0) return "?"
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

export function fromClientRow(c: ClientRow): Client & { contactId?: number } {
  return {
    id: String(c.id),
    name: c.name,
    narahubung: c.contactName ?? "",
    country: c.countryCode,
    initials: getCompanyInitials(c.name),
    phone: c.contactPhone,
    email: c.contactEmail ?? c.email,
    npwp: c.npwp,
    nomorTKU: c.tkuId,
    referenceNumber: c.number,
    lokasi: c.address,
    contactId: c.contactId,
  }
}

export function fromClientHit(h: ClientSearchHit): Client & { contactId?: number } {
  return {
    id: String(h.companyId),
    name: h.companyName,
    narahubung: h.contactName ?? "",
    country: h.companyCountry,
    initials: getCompanyInitials(h.companyName),
    phone: h.contactPhone,
    email: h.contactEmail ?? h.companyEmail,
    npwp: h.companyNpwp,
    nomorTKU: h.companyTku,
    referenceNumber: h.companyNumber,
    lokasi: h.companyAddress,
    contactId: h.contactId,
  }
}

export function dedupeByCompany(hits: ClientSearchHit[]): ClientSearchHit[] {
  const seen = new Set<number>()
  const out: ClientSearchHit[] = []
  for (const h of hits) {
    if (seen.has(h.companyId)) continue
    seen.add(h.companyId)
    out.push(h)
  }
  return out
}
