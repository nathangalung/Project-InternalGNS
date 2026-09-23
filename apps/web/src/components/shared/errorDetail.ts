import { ApiError } from "@/lib/api-client"

export type ErrorCopy = { message: string; detail: string | null }

const GENERIC = "Halaman tidak dapat dimuat. Coba muat ulang atau hubungi administrator."
const SERVER = "Server sedang mengalami gangguan. Coba lagi dalam beberapa saat."

// User-facing copy for a render error.
//
// Server faults (5xx) and unexpected exceptions never show their raw text,
// since that is English, internal, and useless to the reader. A 4xx detail is
// the API's own Indonesian message, so it stays. Development builds keep the
// raw text of unexpected exceptions for debugging.
export function errorCopy(err: unknown, dev: boolean): ErrorCopy {
  if (err instanceof ApiError) {
    if (err.status >= 500) return { message: SERVER, detail: null }
    const msg = err.message.trim()
    return { message: GENERIC, detail: msg || null }
  }
  if (!dev) return { message: GENERIC, detail: null }
  const raw = err instanceof Error ? err.message : typeof err === "string" ? err : null
  return { message: GENERIC, detail: raw?.trim() || null }
}
