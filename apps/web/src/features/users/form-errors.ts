import { ApiError } from "@/lib/api-client"
import { errorMessage } from "@/lib/errors"

// Duplicate email server copy.
export const EMAIL_TAKEN_MESSAGE = "Email sudah digunakan pengguna lain."

export type FormErrors<K extends string> = {
  fields: Partial<Record<K, string>>
  // Message with no field to sit on.
  banner: string | null
}

// Answers the form shows inline.
//
// A 422 carries field messages and a 409 is a business conflict (duplicate
// email, last superadmin, password changed elsewhere). Anything else is a
// transport or server fault and belongs in a toast.
export function isInlineFormError(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 422 || err.status === 409)
}

// Split a user form error.
//
// Known fields land on their inputs; unknown fields and prose go to the
// banner. A 409 whose detail is the duplicate-email copy is shown on the
// email field when the form has one.
export function formErrors<K extends string>(
  err: unknown,
  keys: readonly K[],
  fallback: string,
): FormErrors<K> {
  const fields: Partial<Record<K, string>> = {}
  if (!(err instanceof ApiError)) return { fields, banner: errorMessage(err, fallback) }

  const body = (err.body ?? {}) as { detail?: unknown; fields?: unknown }
  const known = new Set<string>(keys)

  if (err.status === 409 && body.detail === EMAIL_TAKEN_MESSAGE && known.has("email")) {
    fields["email" as K] = EMAIL_TAKEN_MESSAGE
    return { fields, banner: null }
  }

  if (err.status === 422 && body.fields && typeof body.fields === "object") {
    const rest: string[] = []
    for (const [key, value] of Object.entries(body.fields)) {
      const msg = String(value).trim()
      if (!msg) continue
      if (known.has(key)) fields[key as K] = msg
      else rest.push(msg)
    }
    const hasField = Object.keys(fields).length > 0
    if (hasField || rest.length > 0) {
      return { fields, banner: rest.length > 0 ? rest.join(" ") : null }
    }
  }

  return { fields, banner: errorMessage(err, fallback) }
}
