import { ApiError, joinFieldMessages } from "@/lib/api-client"
import { toast } from "@/lib/toast"

// Filesystem-safe invoice number.
export function safeFileName(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]/g, "_")
}

// Indonesian text for transfer failures.
//
// Only 409 and 422 carry text written for the user, in `detail` or in the
// `fields` values; every other status, and the English statusText, falls back
// to the caller's message.
export function transferErrorMessage(err: unknown, fallback: string): string {
  if (!(err instanceof ApiError) || (err.status !== 409 && err.status !== 422)) return fallback
  const detail = err.body?.detail?.trim()
  if (detail) return detail
  return joinFieldMessages(err.body?.fields) || fallback
}

// Run a download, toast failures.
export async function runDownload(run: () => Promise<void>, fallback: string): Promise<void> {
  try {
    await run()
  } catch (err) {
    toast.error(transferErrorMessage(err, fallback))
  }
}
