// API origin and prefix.
//
// "/api/v1" (same origin) unless VITE_API_URL names the API host.
export const API_BASE = (import.meta.env.VITE_API_URL ?? "/api/v1").replace(/\/+$/, "")
