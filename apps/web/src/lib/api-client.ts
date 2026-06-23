const BASE_URL = (import.meta.env.VITE_API_URL ?? "/api/v1").replace(/\/+$/, "")

const TOKEN_KEY = "gns_token"
const REFRESH_KEY = "gns_refresh_token"
const REFRESH_PATH = "/auth/refresh"

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
    message: string,
  ) {
    super(message)
    this.name = "ApiError"
  }
}

type RequestInput = {
  path: string
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"
  body?: unknown
  signal?: AbortSignal
  headers?: Record<string, string>
}

type TokenPair = { token: string; refreshToken?: string }

// Token storage: sessionStorage means refresh-on-tab-close. The trade-off vs
// httpOnly cookies is accepted (no CSRF surface, XSS surface in exchange);
// document that decision in the auth section of round3_plan.md.
export function setTokens(pair: TokenPair): void {
  sessionStorage.setItem(TOKEN_KEY, pair.token)
  if (pair.refreshToken) {
    sessionStorage.setItem(REFRESH_KEY, pair.refreshToken)
  }
}

export function clearTokens(): void {
  sessionStorage.removeItem(TOKEN_KEY)
  sessionStorage.removeItem(REFRESH_KEY)
}

export function getRefreshToken(): string | null {
  return sessionStorage.getItem(REFRESH_KEY)
}

async function rawFetch(path: string, init: RequestInit & { authed?: boolean }): Promise<Response> {
  const token = init.authed === false ? null : sessionStorage.getItem(TOKEN_KEY)
  const headers = new Headers(init.headers)
  if (token) headers.set("authorization", `Bearer ${token}`)
  return fetch(`${BASE_URL}${path}`, { ...init, headers })
}

// In-flight refresh dedupe: simultaneous 401s share one /auth/refresh round-trip.
let refreshInFlight: Promise<boolean> | null = null

async function performRefresh(): Promise<boolean> {
  const refreshToken = getRefreshToken()
  if (!refreshToken) return false
  const res = await fetch(`${BASE_URL}${REFRESH_PATH}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refreshToken }),
  })
  if (!res.ok) {
    clearTokens()
    return false
  }
  const parsed = (await res.json()) as { token: string; refreshToken: string }
  sessionStorage.setItem(TOKEN_KEY, parsed.token)
  sessionStorage.setItem(REFRESH_KEY, parsed.refreshToken)
  return true
}

function tryRefresh(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = performRefresh().finally(() => {
      refreshInFlight = null
    })
  }
  return refreshInFlight
}

// fetchAuthed: hits the API with the JWT, and on 401 transparently refreshes
// + retries the original request once. The refresh path itself bypasses this
// to avoid recursion.
async function fetchAuthed(
  path: string,
  init: RequestInit & { authed?: boolean },
): Promise<Response> {
  const res = await rawFetch(path, init)
  if (res.status !== 401 || path === REFRESH_PATH || init.authed === false) {
    return res
  }
  // Drain the first response body so the connection can be reused.
  void res.body?.cancel()
  const refreshed = await tryRefresh()
  if (!refreshed) {
    clearTokens()
    return res
  }
  return rawFetch(path, init)
}

async function doFetch({
  path,
  method = "GET",
  body,
  signal,
  headers,
}: RequestInput): Promise<Response> {
  return fetchAuthed(path, {
    method,
    signal,
    headers: { "content-type": "application/json", ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

async function parseResponse(res: Response): Promise<unknown> {
  if (res.status === 204) return null
  const text = await res.text()
  return text ? JSON.parse(text) : null
}

export async function apiRequest<T>(input: RequestInput): Promise<T> {
  const res = await doFetch(input)
  if (res.status === 204) return undefined as T
  const parsed = await parseResponse(res)
  if (!res.ok) {
    throw new ApiError(res.status, parsed, extractErrorMessage(parsed, res.statusText))
  }
  return parsed as T
}

// Resolves to null on 404, rethrows otherwise.
export async function nullOn404<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn()
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null
    throw err
  }
}

export type PaginatedList<T> = { rows: T[]; total: number }

type QueryValue = string | number | boolean | undefined | null | (string | number)[]

// Encode a flat params object into a query string. Skips empty strings,
// undefined and null. Arrays are CSV-joined. Booleans/numbers stringify.
export function buildQuery(params: Record<string, QueryValue>): string {
  const search = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue
    if (Array.isArray(v)) {
      if (v.length > 0) search.set(k, v.join(","))
      continue
    }
    if (typeof v === "string") {
      if (v) search.set(k, v)
      continue
    }
    search.set(k, String(v))
  }
  return search.toString()
}

// Returns rows + total from X-Total-Count. Falls back to rows.length if absent.
export async function apiList<T>(input: RequestInput): Promise<PaginatedList<T>> {
  const res = await doFetch(input)
  const parsed = await parseResponse(res)
  if (!res.ok) {
    throw new ApiError(res.status, parsed, extractErrorMessage(parsed, res.statusText))
  }
  const rows = (parsed ?? []) as T[]
  const header = res.headers.get("X-Total-Count")
  const total = header ? Number.parseInt(header, 10) : rows.length
  return { rows, total: Number.isFinite(total) ? total : rows.length }
}

function extractErrorMessage(parsed: unknown, fallback: string): string {
  if (!parsed || typeof parsed !== "object") return fallback
  const body = parsed as { detail?: unknown; fields?: Record<string, unknown>; title?: unknown }
  if (typeof body.detail === "string" && body.detail.length > 0) return body.detail
  if (body.fields && typeof body.fields === "object") {
    const parts = Object.entries(body.fields).map(([k, v]) => `${k}: ${String(v)}`)
    if (parts.length > 0) return parts.join("; ")
  }
  if (typeof body.title === "string" && body.title.length > 0) return body.title
  return fallback
}

type PickerType = { description: string; accept: Record<string, string[]> }

const PICKER_PDF: PickerType = { description: "PDF", accept: { "application/pdf": [".pdf"] } }
const PICKER_XML: PickerType = { description: "XML", accept: { "application/xml": [".xml"] } }
const PICKER_XLSX: PickerType = {
  description: "Excel",
  accept: {
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
  },
}

// Fetch binary endpoint as blob; let user pick dir + edit filename when supported.
async function downloadBinary(
  path: string,
  filename: string,
  pickerType: PickerType,
): Promise<void> {
  const res = await fetchAuthed(path, { method: "GET" })
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new ApiError(res.status, text, `Download failed: ${res.statusText}`)
  }
  const blob = await res.blob()
  await saveBlob(blob, filename, pickerType)
}

export const downloadPdf = (path: string, filename: string) =>
  downloadBinary(path, filename, PICKER_PDF)
export const downloadXml = (path: string, filename: string) =>
  downloadBinary(path, filename, PICKER_XML)
export const downloadXlsx = (path: string, filename: string) =>
  downloadBinary(path, filename, PICKER_XLSX)

// Authed PUT of a file to an API asset path (proxy upload to MinIO).
export async function uploadAsset(path: string, file: File): Promise<void> {
  const res = await fetchAuthed(path, {
    method: "PUT",
    body: file,
    headers: { "Content-Type": file.type || "application/octet-stream" },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new ApiError(res.status, text, `Upload failed: ${res.statusText}`)
  }
}

// Authed GET of an asset as a blob object URL (for <img src>). Caller revokes.
export async function fetchObjectUrl(path: string): Promise<string> {
  const res = await fetchAuthed(path, { method: "GET" })
  if (!res.ok) {
    throw new ApiError(res.status, null, `Fetch failed: ${res.statusText}`)
  }
  const blob = await res.blob()
  return URL.createObjectURL(blob)
}

// File System Access API where supported; else anchor fallback.
export async function saveBlob(
  blob: Blob,
  filename: string,
  pickerType: PickerType = PICKER_PDF,
): Promise<void> {
  const w = window as unknown as {
    showSaveFilePicker?: (opts: {
      suggestedName: string
      types?: PickerType[]
    }) => Promise<FileSystemFileHandle>
  }
  if (typeof w.showSaveFilePicker === "function") {
    try {
      const handle = await w.showSaveFilePicker({
        suggestedName: filename,
        types: [pickerType],
      })
      const writable = await handle.createWritable()
      await writable.write(blob)
      await writable.close()
      return
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return
    }
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
