import { ApiError } from "@/lib/api-client"
import { toast } from "@/lib/toast"

// Filesystem-safe invoice number.
export function safeFileName(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]/g, "_")
}

// Problem body, raw or parsed.
//
// Binary downloads and uploads keep the body as text; apiRequest has already
// parsed it. Both arrive here as problem+json.
function problemOf(body: unknown): { detail?: unknown; fields?: unknown } | null {
  if (typeof body === "string") {
    try {
      const parsed: unknown = JSON.parse(body)
      return parsed && typeof parsed === "object" ? parsed : null
    } catch {
      return null
    }
  }
  return body && typeof body === "object" ? body : null
}

// Indonesian text for transfer failures.
//
// Only 409 and 422 carry text written for the user, in `detail` or in the
// `fields` values; every other status, and the English statusText, falls back
// to the caller's message.
export function transferErrorMessage(err: unknown, fallback: string): string {
  if (!(err instanceof ApiError) || (err.status !== 409 && err.status !== 422)) return fallback
  const problem = problemOf(err.body)
  if (!problem) return fallback
  if (typeof problem.detail === "string" && problem.detail.trim() !== "") return problem.detail
  if (problem.fields && typeof problem.fields === "object") {
    const parts = Object.values(problem.fields)
      .filter((v): v is string => typeof v === "string" && v.trim() !== "")
      .map((v) => v.trim())
    if (parts.length > 0) return parts.join("; ")
  }
  return fallback
}

// Run a download, toast failures.
export async function runDownload(run: () => Promise<void>, fallback: string): Promise<void> {
  try {
    await run()
  } catch (err) {
    toast.error(transferErrorMessage(err, fallback))
  }
}
