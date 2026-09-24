// Run settings, all overridable from the environment.
export const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:5174"
export const apiURL = process.env.E2E_API_URL ?? `${baseURL}/api/v1`

export const roles = ["superadmin", "operational", "finance"] as const
export type Role = (typeof roles)[number]

// Fixed addresses, so reruns reuse the same rows instead of piling up users.
export const e2eUsers = {
  operational: { email: "e2e.operational@globalsakti.com", name: "E2E Operasional" },
  finance: { email: "e2e.finance@globalsakti.com", name: "E2E Keuangan" },
} as const satisfies Record<Exclude<Role, "superadmin">, { email: string; name: string }>

// The superadmin comes from the environment, never from source.
export function adminCredentials(): { email: string; password: string } {
  const email = process.env.E2E_ADMIN_EMAIL
  const password = process.env.E2E_ADMIN_PASSWORD
  if (!email || !password) {
    throw new Error(
      "E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD must be set (make e2e reads apps/api/.env)",
    )
  }
  return { email, password }
}

export const authDir = new URL("../.auth/", import.meta.url)
export const authFile = (role: Role) => new URL(`${role}.json`, authDir)
