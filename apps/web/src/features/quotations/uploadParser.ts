import type { MatchRowInput } from "@/types/api"

// Required + optional headers (case-insensitive).
const HEADER_KEYS = {
  no: ["no", "nomor", "#"],
  impa: ["impa", "kode impa", "kode"],
  name: ["nama", "produk", "name", "deskripsi"],
  qty: ["kuantitas", "jumlah", "qty", "quantity"],
  unit: ["satuan", "unit"],
}

type HeaderIdx = {
  impa: number
  name: number
  qty: number
  unit: number
}

// Match a header column by key.
function findIdx(headers: string[], keys: string[]): number {
  const norm = headers.map((h) => (h ?? "").toString().trim().toLowerCase())
  for (const k of keys) {
    const exact = norm.findIndex((h) => h === k)
    if (exact !== -1) return exact
  }
  for (const k of keys) {
    const partial = norm.findIndex((h) => h.includes(k))
    if (partial !== -1) return partial
  }
  return -1
}

function detectHeaders(headers: string[]): HeaderIdx | null {
  const idx: HeaderIdx = {
    impa: findIdx(headers, HEADER_KEYS.impa),
    name: findIdx(headers, HEADER_KEYS.name),
    qty: findIdx(headers, HEADER_KEYS.qty),
    unit: findIdx(headers, HEADER_KEYS.unit),
  }
  if (idx.name === -1) return null
  return idx
}

// Locate the header row within leading rows.
function findHeaderRow(aoa: unknown[][]): { row: number; idx: HeaderIdx } | null {
  const scan = Math.min(aoa.length, 15)
  let best: { row: number; idx: HeaderIdx; score: number } | null = null
  for (let r = 0; r < scan; r++) {
    const headers = (aoa[r] ?? []).map((c) => (c ?? "").toString())
    const idx = detectHeaders(headers)
    if (!idx) continue
    const score = [idx.impa, idx.name, idx.qty, idx.unit].filter((x) => x >= 0).length
    if (!best || score > best.score) best = { row: r, idx, score }
  }
  return best ? { row: best.row, idx: best.idx } : null
}

// Parse quantity tolerating id-ID format.
export function parseQty(raw: unknown): number {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : 0
  const s = String(raw ?? "").trim()
  if (!s) return 0
  const normalized = s.replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".")
  const n = Number(normalized)
  return Number.isFinite(n) ? n : 0
}

// Extract product rows from a sheet.
export function rowsFromAOA(aoa: unknown[][]): MatchRowInput[] {
  const found = findHeaderRow(aoa)
  if (!found) return []
  const { row: headerRow, idx } = found

  const out: MatchRowInput[] = []
  for (let i = headerRow + 1; i < aoa.length; i++) {
    const row = aoa[i]
    if (!row || row.every((c) => c == null || c === "")) continue
    const name = idx.name >= 0 ? String(row[idx.name] ?? "").trim() : ""
    if (!name) continue
    const impaRaw = idx.impa >= 0 ? row[idx.impa] : ""
    const qtyRaw = idx.qty >= 0 ? row[idx.qty] : 0
    const unitRaw = idx.unit >= 0 ? row[idx.unit] : ""
    out.push({
      impaCode: impaRaw == null ? "" : String(impaRaw).trim(),
      name,
      qty: parseQty(qtyRaw),
      unit: unitRaw == null ? "" : String(unitRaw).trim(),
    })
  }
  return out
}

// ExcelJS cells may be formulas, rich text, or hyperlinks; reduce each to its
// display text so detection and extraction stay format-agnostic.
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

// Read every sheet into arrays of rows.
async function parseXlsx(buf: ArrayBuffer): Promise<unknown[][][]> {
  const { default: ExcelJS } = await import("exceljs")
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buf)
  const sheets: unknown[][][] = []
  for (const ws of wb.worksheets) {
    const aoa: unknown[][] = []
    ws.eachRow({ includeEmpty: false }, (row) => {
      // row.values is 1-indexed; slot 0 is unused.
      const values = row.values as unknown[]
      const arr = Array.isArray(values) ? values.slice(1) : []
      aoa.push(arr.map(cellToPrimitive))
    })
    if (aoa.length) sheets.push(aoa)
  }
  return sheets
}

// Minimal RFC 4180 CSV parser: quoted fields, escaped quotes, CRLF or LF.
export function parseCsv(text: string): unknown[][] {
  const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const rows: string[][] = []
  let row: string[] = []
  let field = ""
  let inQuotes = false
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i]
    if (inQuotes) {
      if (c === '"') {
        if (clean[i + 1] === '"') {
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
      if (c === "\r" && clean[i + 1] === "\n") i++
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

// Parse an uploaded product file.
export async function parseProductFile(file: File): Promise<MatchRowInput[]> {
  const lower = file.name.toLowerCase()
  if (lower.endsWith(".csv")) {
    const text = await file.text()
    return rowsFromAOA(parseCsv(text))
  }
  const buf = await file.arrayBuffer()
  const sheets = await parseXlsx(buf)
  for (const sheet of sheets) {
    const rows = rowsFromAOA(sheet)
    if (rows.length) return rows
  }
  return []
}
