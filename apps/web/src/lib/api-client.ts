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

export async function apiRequest<T>({
  path,
  method = "GET",
  body,
  signal,
  headers,
}: RequestInput): Promise<T> {
  const token = sessionStorage.getItem("gns_token")
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    signal,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })

  if (res.status === 204) return undefined as T

  const text = await res.text()
  const parsed: unknown = text ? JSON.parse(text) : null

  if (!res.ok) {
    const message =
      parsed && typeof parsed === "object" && "detail" in parsed
        ? String((parsed as { detail: unknown }).detail)
        : res.statusText
    throw new ApiError(res.status, parsed, message)
  }

  return parsed as T
}

// Fetch PDF as blob and trigger browser download.
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
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
