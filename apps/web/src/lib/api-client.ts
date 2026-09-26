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
  // False for credential calls: a 401 is an answer, not an expired session
  authed?: boolean
}

type TokenPair = { token: string; refreshToken?: string }

// Token storage in sessionStorage.
//
// sessionStorage means refresh-on-tab-close. The trade-off vs httpOnly cookies
// is accepted (no CSRF surface, XSS surface in exchange); document that
// decision in the auth section of round3_plan.md.
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

// In-flight refresh dedupe.
//
// Simultaneous 401s share one /auth/refresh round-trip.
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

// Final refresh failure hook.
//
// Notifies the auth layer once refresh definitively fails.
let onAuthExpired: (() => void) | null = null

export function setOnAuthExpired(fn: () => void): void {
  onAuthExpired = fn
}

// fetchAuthed: API call with JWT.
//
// On 401 it transparently refreshes and retries the original request once. The
// refresh path itself bypasses this to avoid recursion.
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
    onAuthExpired?.()
    // The drained body cannot be re-read, so surface a typed error.
    throw new ApiError(401, null, "Sesi berakhir, silakan masuk kembali.")
  }
  return rawFetch(path, init)
}

async function doFetch({
  path,
  method = "GET",
  body,
  signal,
  headers,
  authed,
}: RequestInput): Promise<Response> {
  return fetchAuthed(path, {
    method,
    signal,
    authed,
    headers: { "content-type": "application/json", ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

async function parseResponse(res: Response): Promise<unknown> {
  if (res.status === 204) return null
  const text = await res.text()
  return text ? JSON.parse(text) : null
}

// Problem body, or null.
//
// Error bodies are read leniently: a proxy's HTML error page or an empty body
// becomes null instead of a SyntaxError reaching the toast.
export function parseProblem(text: string): unknown {
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

// Error from a failed response.
async function failure(res: Response): Promise<ApiError> {
  const problem = parseProblem(await res.text().catch(() => ""))
  const fallback = `Permintaan gagal (${res.status}).`
  return new ApiError(res.status, problem, extractErrorMessage(problem, fallback))
}

export async function apiRequest<T>(input: RequestInput): Promise<T> {
  const res = await doFetch(input)
  if (!res.ok) throw await failure(res)
  if (res.status === 204) return undefined as T
  return (await parseResponse(res)) as T
}

// Null on 404, else rethrow.
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

// Flat params to query string.
//
// Skips empty strings, undefined and null. Arrays are CSV-joined.
// Booleans/numbers stringify.
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

// Rows plus X-Total-Count total.
//
// Falls back to rows.length when the header is absent.
export async function apiList<T>(input: RequestInput): Promise<PaginatedList<T>> {
  const res = await doFetch(input)
  if (!res.ok) throw await failure(res)
  const parsed = await parseResponse(res)
  const rows = (parsed ?? []) as T[]
  const header = res.headers.get("X-Total-Count")
  const total = header ? Number.parseInt(header, 10) : rows.length
  return { rows, total: Number.isFinite(total) ? total : rows.length }
}

// Most human RFC 7807 message.
//
// `detail` is prose meant for the user, so it always wins. `fields` is keyed by
// API field name, which is an identifier and not Indonesian, so only its
// values are shown -- never `key: value`, which reads as debug output in a
// toast.
export function extractErrorMessage(parsed: unknown, fallback: string): string {
  if (!parsed || typeof parsed !== "object") return fallback
  const body = parsed as { detail?: unknown; fields?: Record<string, unknown>; title?: unknown }
  if (typeof body.detail === "string" && body.detail.length > 0) return body.detail
  if (body.fields && typeof body.fields === "object") {
    const parts = Object.values(body.fields)
      .map((v) => String(v).trim())
      .filter((v) => v.length > 0)
    if (parts.length > 0) return parts.join("; ")
  }
  if (typeof body.title === "string" && body.title.length > 0) return body.title
  return fallback
}

export type TransferKind = "upload" | "download"

const TRANSFER_FALLBACK: Record<TransferKind, string> = {
  upload: "Gagal mengunggah berkas.",
  download: "Gagal mengunduh berkas.",
}

// Failed transfer, in Indonesian.
//
// The storage proxy writes English details, so only the document routes'
// 409 and 422, which are written for the user, pass through. An upload 409
// is a key clash, and a 400 is usually a refused file type.
export function transferFailureMessage(
  kind: TransferKind,
  status: number,
  problem: unknown,
): string {
  const fallback = TRANSFER_FALLBACK[kind]
  if (kind === "upload") {
    if (status === 409) return "Berkas dengan nama yang sama baru saja diunggah. Coba lagi."
    if (status === 400) return "Jenis berkas tidak diizinkan."
    return fallback
  }
  if (status === 409 || status === 422) return extractErrorMessage(problem, fallback)
  return fallback
}

// Error from a failed transfer.
async function transferFailure(res: Response, kind: TransferKind): Promise<ApiError> {
  const problem = parseProblem(await res.text().catch(() => ""))
  return new ApiError(res.status, problem, transferFailureMessage(kind, res.status, problem))
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
const PICKER_ANY: PickerType = { description: "Berkas", accept: { "*/*": [] } }

// Save dialog filter by extension.
function pickerForFilename(filename: string): PickerType {
  const ext = filename.split(".").pop()?.toLowerCase()
  if (ext === "pdf") return PICKER_PDF
  if (ext === "xlsx") return PICKER_XLSX
  if (ext === "xml") return PICKER_XML
  return PICKER_ANY
}

// Fetch a binary, then save.
//
// Fetches the endpoint as a blob and, when supported, lets the user pick the
// directory and edit the filename.
async function downloadBinary(
  path: string,
  filename: string,
  pickerType: PickerType,
): Promise<void> {
  const res = await fetchAuthed(path, { method: "GET" })
  if (!res.ok) throw await transferFailure(res, "download")
  const blob = await res.blob()
  await saveBlob(blob, filename, pickerType)
}

export const downloadPdf = (path: string, filename: string) =>
  downloadBinary(path, filename, PICKER_PDF)
export const downloadXml = (path: string, filename: string) =>
  downloadBinary(path, filename, PICKER_XML)
export const downloadXlsx = (path: string, filename: string) =>
  downloadBinary(path, filename, PICKER_XLSX)

// Authed download, picker by extension.
export const downloadFile = (path: string, filename: string) =>
  downloadBinary(path, filename, pickerForFilename(filename))

// Authed asset file PUT.
//
// Uploads to an API asset path, which proxies it to MinIO.
export async function uploadAsset(path: string, file: File): Promise<void> {
  const res = await fetchAuthed(path, {
    method: "PUT",
    body: file,
    headers: { "Content-Type": file.type || "application/octet-stream" },
  })
  if (!res.ok) throw await transferFailure(res, "upload")
}

// Authed asset object URL.
//
// Fetches the asset as a blob object URL for <img src>. The caller revokes it.
export async function fetchObjectUrl(path: string): Promise<string> {
  const res = await fetchAuthed(path, { method: "GET" })
  if (!res.ok) throw await transferFailure(res, "download")
  const blob = await res.blob()
  return URL.createObjectURL(blob)
}

// Save a blob locally.
//
// Uses the File System Access API where supported, else an anchor fallback.
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
