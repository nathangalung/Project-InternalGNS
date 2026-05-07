import * as XLSX from "xlsx"
import type { MatchRowInput } from "@/types/api"

// Required + optional headers (case-insensitive, partial match).
const HEADER_KEYS = {
  no: ["no", "nomor", "#"],
  impa: ["impa", "kode impa", "code"],
  name: ["nama", "produk", "name", "deskripsi"],
  qty: ["kuantitas", "jumlah", "qty", "quantity"],
  unit: ["satuan", "unit"],
}

type HeaderIdx = {
  no: number
  impa: number
  name: number
  qty: number
  unit: number
}

function findIdx(headers: string[], keys: string[]): number {
  const norm = headers.map(h => (h ?? "").toString().trim().toLowerCase())
  for (const k of keys) {
    const idx = norm.findIndex(h => h === k || h.includes(k))
    if (idx !== -1) return idx
  }
  return -1
}

function detectHeaders(headers: string[]): HeaderIdx | null {
  const idx: HeaderIdx = {
    no: findIdx(headers, HEADER_KEYS.no),
    impa: findIdx(headers, HEADER_KEYS.impa),
    name: findIdx(headers, HEADER_KEYS.name),
    qty: findIdx(headers, HEADER_KEYS.qty),
    unit: findIdx(headers, HEADER_KEYS.unit),
  }
  if (idx.name === -1) return null
  return idx
}

function rowsFromAOA(aoa: unknown[][]): MatchRowInput[] {
  if (aoa.length < 2) return []
  const headers = (aoa[0] as unknown[]).map(c => (c ?? "").toString())
  const idx = detectHeaders(headers)
  if (!idx) return []

  const out: MatchRowInput[] = []
  for (let i = 1; i < aoa.length; i++) {
    const row = aoa[i] as unknown[]
    if (!row || row.every(c => c == null || c === "")) continue
    const name = idx.name >= 0 ? String(row[idx.name] ?? "").trim() : ""
    if (!name) continue
    const impaRaw = idx.impa >= 0 ? row[idx.impa] : ""
    const qtyRaw = idx.qty >= 0 ? row[idx.qty] : 0
    const unitRaw = idx.unit >= 0 ? row[idx.unit] : ""
    out.push({
      impaCode: impaRaw == null ? "" : String(impaRaw).trim(),
      name,
      qty: Number(qtyRaw) || 0,
      unit: unitRaw == null ? "" : String(unitRaw).trim(),
    })
  }
  return out
}

export async function parseProductFile(file: File): Promise<MatchRowInput[]> {
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: "array" })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  if (!sheet) return []
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false, defval: "" })
  return rowsFromAOA(aoa)
}
