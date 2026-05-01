import type { PoLocalRecord } from "./types"

const STORAGE_KEY = "gns_po_records_v1"

type StoreShape = Record<string, PoLocalRecord>

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

export function getRecord(quotationId: number): PoLocalRecord | undefined {
  return readAll()[String(quotationId)]
}

export function getAllRecords(): StoreShape {
  return readAll()
}

export function upsertRecord(quotationId: number, patch: Partial<PoLocalRecord>) {
  const all = readAll()
  const prev = all[String(quotationId)] ?? { status: "PENDING" as const }
  all[String(quotationId)] = { ...prev, ...patch }
  writeAll(all)
}

export function poNumberFor(quotationNo: string): string {
  // Map "Q-..." to "PO-...". Fallback prefixes the original.
  if (quotationNo.startsWith("Q-")) return "PO-" + quotationNo.slice(2)
  if (quotationNo.startsWith("Q")) return "PO" + quotationNo.slice(1)
  return "PO-" + quotationNo
}
