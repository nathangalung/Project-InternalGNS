import type { UpdateContactInput } from "@/features/clients/api"
import type { Client } from "@/features/quotations/Step1Client"
import type { ClientRow, ClientSearchHit, ClientSummary } from "@/types/api"

// Two-letter avatar initials.
//
// Strips a leading "PT" / "PT." prefix since most local company names start
// with it.
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

// Percent text, or a dash.
function pctText(num: number, den: number, signed: boolean): string {
  if (den <= 0) return "-"
  const pct = Math.round((num / den) * 100)
  return `${signed && pct >= 0 ? "+" : ""}${pct}%`
}

export type ClientKpis = {
  total: number
  // Base growth since 1 January.
  growth: string
  newThisMonth: number
  // Active clients over all clients.
  activeShare: string
}

// Client list KPI figures.
//
// prevYearTotal is every client created before this year, so the base grew
// by newThisYear over it. A true year-over-year figure needs a dated count
// from the API.
export function clientKpis(s: ClientSummary | undefined): ClientKpis {
  const total = s?.total ?? 0
  return {
    total,
    growth: pctText(s?.newThisYear ?? 0, s?.prevYearTotal ?? 0, true),
    newThisMonth: s?.newThisMonth ?? 0,
    activeShare: pctText(s?.activeCount ?? 0, total, false),
  }
}

export type ContactFormValues = {
  name: string
  phone: string
  email: string
  title: string
}

// PATCH body for a contact.
//
// The API keeps an absent email or title, so a blank one is sent as "" to
// clear it. Phone is replaced on every call, so blank simply drops it.
export function contactUpdateBody(f: ContactFormValues, countryCode: string): UpdateContactInput {
  return {
    name: f.name.trim(),
    phone: f.phone.trim() || undefined,
    email: f.email.trim(),
    title: f.title.trim(),
    countryCode,
  }
}
