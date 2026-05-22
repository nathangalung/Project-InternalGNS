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
