import { ApiError, joinFieldMessages } from "@/lib/api-client"
import { toast } from "@/lib/toast"
import type { CoretaxRefusal, CoretaxRefusalProblem } from "@/types/api"

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

// Coretax refusal rows, if any
export function coretaxRefusals(err: unknown): CoretaxRefusal[] | null {
  if (!(err instanceof ApiError) || err.status !== 422) return null
  const body: Partial<CoretaxRefusalProblem> | null = err.body
  if (body?.code !== "coretax_refused" || !Array.isArray(body.refused)) return null
  return body.refused.length > 0 ? body.refused : null
}

// Coretax download, refusals listed
export async function runCoretaxDownload(
  run: () => Promise<void>,
  fallback: string,
  onRefused: (rows: CoretaxRefusal[]) => void,
): Promise<void> {
  try {
    await run()
  } catch (err) {
    const rows = coretaxRefusals(err)
    if (rows) onRefused(rows)
    else toast.error(transferErrorMessage(err, fallback))
  }
}

// Run a download, toast failures.
export async function runDownload(run: () => Promise<void>, fallback: string): Promise<void> {
  try {
    await run()
  } catch (err) {
    toast.error(transferErrorMessage(err, fallback))
  }
}
