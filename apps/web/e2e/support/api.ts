import { randomBytes } from "node:crypto"
import { apiURL } from "./env"

export type Tokens = { token: string; refreshToken?: string }

type User = { id: number; email: string; name: string; role: string; isActive: boolean }

async function call(path: string, init: RequestInit & { token?: string } = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  headers.set("content-type", "application/json")
  if (init.token) headers.set("authorization", `Bearer ${init.token}`)
  return fetch(`${apiURL}${path}`, { ...init, headers })
}

async function expectOk(res: Response, what: string): Promise<Response> {
  if (!res.ok) throw new Error(`${what}: ${res.status} ${await res.text()}`)
  return res
}

// Login is limited to 5 per minute per IP; wait once when throttled.
export async function login(email: string, password: string): Promise<Tokens> {
  const body = JSON.stringify({ email, password })
  let res = await call("/auth/login", { method: "POST", body })
  if (res.status === 429) {
    const wait = Number(res.headers.get("retry-after") ?? "60")
    await new Promise((r) => setTimeout(r, (wait + 1) * 1000))
    res = await call("/auth/login", { method: "POST", body })
  }
  await expectOk(res, `login ${email}`)
  return (await res.json()) as Tokens
}

// Meets the password policy: upper, digit and symbol.
export function generatePassword(): string {
  return `E2e!${randomBytes(9).toString("base64url")}7`
}

async function findUser(admin: string, email: string): Promise<User> {
  const res = await expectOk(
    await call(`/users?q=${encodeURIComponent(email)}`, { token: admin }),
    `find ${email}`,
  )
  const match = ((await res.json()) as User[]).find((u) => u.email === email)
  if (!match) throw new Error(`user ${email} exists but was not found`)
  return match
}

// Creates the user, or reactivates it and resets its password.
export async function ensureUser(
  admin: string,
  user: { email: string; name: string; role: string },
  password: string,
): Promise<void> {
  const created = await call("/users", {
    method: "POST",
    token: admin,
    body: JSON.stringify({ ...user, password, isActive: true }),
  })
  if (created.status !== 409) {
    await expectOk(created, `create ${user.email}`)
    return
  }
  const existing = await findUser(admin, user.email)
  await expectOk(
    await call(`/users/${existing.id}`, {
      method: "PUT",
      token: admin,
      body: JSON.stringify({ ...user, isActive: true }),
    }),
    `reactivate ${user.email}`,
  )
  await expectOk(
    await call(`/users/${existing.id}/password`, {
      method: "PATCH",
      token: admin,
      body: JSON.stringify({ password }),
    }),
    `reset password ${user.email}`,
  )
}

// The API has no user delete, so removal means deactivation.
export async function deactivateUser(admin: string, email: string): Promise<void> {
  const u = await findUser(admin, email)
  await expectOk(
    await call(`/users/${u.id}`, {
      method: "PUT",
      token: admin,
      body: JSON.stringify({ email: u.email, name: u.name, role: u.role, isActive: false }),
    }),
    `deactivate ${email}`,
  )
}
