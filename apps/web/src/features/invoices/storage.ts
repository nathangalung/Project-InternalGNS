import type { InvoiceLocalRecord } from "./types"

const STORAGE_KEY = "gns_invoice_records_v1"

type StoreShape = Record<string, InvoiceLocalRecord>

function readAll(): StoreShape {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === "object") return parsed as StoreShape
    return {}
  } catch {
    return {}
  }
}

function writeAll(store: StoreShape) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
}

export function getRecord(quotationId: number): InvoiceLocalRecord | undefined {
  return readAll()[String(quotationId)]
}

export function getAllRecords(): StoreShape {
  return readAll()
}

export function upsertRecord(quotationId: number, patch: Partial<InvoiceLocalRecord>) {
  const all = readAll()
  const prev = all[String(quotationId)] ?? { status: "DRAF" as const }
  all[String(quotationId)] = { ...prev, ...patch }
  writeAll(all)
}

// Build invoice number from quotation id and createdAt year. Padded to 4 digits.
export function invoiceNumberFor(quotationId: number, createdAtIso: string): string {
  const d = new Date(createdAtIso)
  const year = Number.isNaN(d.getTime()) ? new Date().getFullYear() : d.getFullYear()
  const seq = String(quotationId).padStart(4, "0")
  return `INV-${year}/${seq}`
}
