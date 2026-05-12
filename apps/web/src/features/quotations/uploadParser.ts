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
  const norm = headers.map((h) => (h ?? "").toString().trim().toLowerCase())
  for (const k of keys) {
    const idx = norm.findIndex((h) => h === k || h.includes(k))
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
  const headers = (aoa[0] as unknown[]).map((c) => (c ?? "").toString())
  const idx = detectHeaders(headers)
  if (!idx) return []

  const out: MatchRowInput[] = []
  for (let i = 1; i < aoa.length; i++) {
    const row = aoa[i] as unknown[]
    if (!row || row.every((c) => c == null || c === "")) continue
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

// ExcelJS cell values can be primitives, formula objects, hyperlink objects,
// or rich text. Reduce each to its display text so header detection + row
// extraction stay format-agnostic.
function cellToPrimitive(value: unknown): unknown {
  if (value == null) return ""
  if (typeof value === "object") {
    const v = value as Record<string, unknown>
    if ("result" in v) return cellToPrimitive(v.result)
    if ("text" in v) return v.text
    if ("richText" in v && Array.isArray(v.richText)) {
      return (v.richText as Array<{ text?: string }>).map((r) => r.text ?? "").join("")
    }
    if ("hyperlink" in v && "text" in v) return v.text
    if (value instanceof Date) return value
  }
  return value
}

async function parseXlsx(buf: ArrayBuffer): Promise<unknown[][]> {
  const { default: ExcelJS } = await import("exceljs")
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buf)
  const ws = wb.worksheets[0]
  if (!ws) return []
  const aoa: unknown[][] = []
  ws.eachRow({ includeEmpty: false }, (row) => {
    // row.values is 1-indexed (slot 0 is unused). Trim the leading slot.
    const values = row.values as unknown[]
    const arr = Array.isArray(values) ? values.slice(1) : []
    aoa.push(arr.map(cellToPrimitive))
  })
  return aoa
}

// Minimal RFC 4180 CSV parser: handles quoted fields, escaped quotes ("")
// and CRLF/LF line endings. Trailing empty lines are dropped by the caller.
function parseCsv(text: string): unknown[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ""
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += c
      }
      continue
    }
    if (c === '"') {
      inQuotes = true
      continue
    }
    if (c === ",") {
      row.push(field)
      field = ""
      continue
    }
    if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++
      row.push(field)
      field = ""
      rows.push(row)
      row = []
      continue
    }
    field += c
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => r.some((c) => c !== ""))
}

export async function parseProductFile(file: File): Promise<MatchRowInput[]> {
  const lower = file.name.toLowerCase()
  if (lower.endsWith(".csv")) {
    const text = await file.text()
    return rowsFromAOA(parseCsv(text))
  }
  const buf = await file.arrayBuffer()
  return rowsFromAOA(await parseXlsx(buf))
}
