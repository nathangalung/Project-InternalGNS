const BASE_URL = (import.meta.env.VITE_API_URL ?? "/api/v1").replace(/\/+$/, "")

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

async function doFetch({
  path,
  method = "GET",
  body,
  signal,
  headers,
}: RequestInput): Promise<Response> {
  const token = sessionStorage.getItem("gns_token")
  return fetch(`${BASE_URL}${path}`, {
    method,
    signal,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
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

export type PaginatedList<T> = { rows: T[]; total: number }

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

// Fetch PDF as blob; let user pick dir + edit filename when supported.
export async function downloadPdf(path: string, filename: string): Promise<void> {
  const token = sessionStorage.getItem("gns_token")
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "GET",
    headers: token ? { authorization: `Bearer ${token}` } : undefined,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new ApiError(res.status, text, `PDF download failed: ${res.statusText}`)
  }
  const blob = await res.blob()
  await saveBlob(blob, filename)
}

// File System Access API where supported; else anchor fallback.
export async function saveBlob(blob: Blob, filename: string): Promise<void> {
  const w = window as unknown as {
    showSaveFilePicker?: (opts: {
      suggestedName: string
      types?: { description: string; accept: Record<string, string[]> }[]
    }) => Promise<FileSystemFileHandle>
  }
  if (typeof w.showSaveFilePicker === "function") {
    try {
      const handle = await w.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: "PDF", accept: { "application/pdf": [".pdf"] } }],
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
