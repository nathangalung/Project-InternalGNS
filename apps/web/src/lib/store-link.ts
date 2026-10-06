// Store link rules.
//
// Mirrors apps/api/internal/shared/validate/url.go: only an http or https
// address with a host and no spaces is a store link, so an anchor built
// from one never runs script.

export const STORE_URL_ERROR = "Link toko harus diawali http:// atau https://."

const MAX_URL_LEN = 2048

// Parsed link, or null.
function parse(s: string): URL | null {
  if (s.length > MAX_URL_LEN || /\s/.test(s)) return null
  try {
    const u = new URL(s)
    if (u.protocol !== "http:" && u.protocol !== "https:") return null
    return u.hostname ? u : null
  } catch {
    return null
  }
}

// Optional link, checked once filled.
export function storeUrlError(s: string): string | null {
  const t = s.trim()
  return t === "" || parse(t) ? null : STORE_URL_ERROR
}

export type StoreLink = { href: string; host: string }

// Safe anchor target, or null.
export function storeLink(url: string | null | undefined): StoreLink | null {
  const t = url?.trim() ?? ""
  const u = t ? parse(t) : null
  return u ? { href: t, host: u.hostname.replace(/^www\./, "") } : null
}
