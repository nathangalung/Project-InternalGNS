import { ApiError } from "@/lib/api-client"

// Map error to user-facing text.
//
// A failed fetch (TypeError) or an unreadable body (SyntaxError) carries the
// browser's English text, so it shows the fallback. Errors the app throws
// itself, such as the upload checks, carry Indonesian copy and pass through.
export function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    const msg = err.message?.trim()
    if (msg && msg.length > 0) return msg
    return fallback
  }
  if (err instanceof TypeError || err instanceof SyntaxError) return fallback
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

// Problem code, if any.
//
// A stable tag the server adds for conditions the web must branch on, such
// as a stale version or a PO lock, so no caller matches on detail text.
export function problemCode(err: unknown): string | undefined {
  return err instanceof ApiError ? err.body?.code : undefined
}

export const VERSION_CONFLICT_CODE = "version_conflict"

// Stale If-Match on save.
//
// Someone else saved the record first; the page reloads it and the user
// repeats the edit on the newer version.
export function isVersionConflict(err: unknown): boolean {
  return err instanceof ApiError && err.status === 409 && problemCode(err) === VERSION_CONFLICT_CODE
}
