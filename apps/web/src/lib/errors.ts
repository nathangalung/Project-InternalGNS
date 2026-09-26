import { ApiError } from "@/lib/api-client"

// Map error to user-facing text.
export function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    const msg = err.message?.trim()
    if (msg && msg.length > 0) return msg
    return fallback
  }
  if (err instanceof Error) {
    const msg = err.message?.trim()
    if (msg && msg.length > 0) return msg
  }
  return fallback
}

// Record missing, not failed.
//
// A bad id (400) or an unknown one (404) is a not-found page. Anything else,
// such as a 403 or a network error, is a failure the reader can retry.
export function isMissing(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 400 || err.status === 404)
}
