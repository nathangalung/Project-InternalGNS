import { randomBytes } from "node:crypto"
import { apiURL } from "./env"

export type Tokens = { token: string; refreshToken?: string }

export type User = { id: number; email: string; name: string; role: string; isActive: boolean }

export type CallInit = RequestInit & { token?: string; ip?: string }

export async function call(path: string, init: CallInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  headers.set("content-type", "application/json")
  if (init.token) headers.set("authorization", `Bearer ${init.token}`)
  if (init.ip) headers.set("x-forwarded-for", init.ip)
  return fetch(`${apiURL}${path}`, { ...init, headers })
}

export async function expectOk(res: Response, what: string): Promise<Response> {
  if (!res.ok) throw new Error(`${what}: ${res.status} ${await res.text()}`)
  return res
}

// A fresh client address.
//
// The API keys its login and password-change limits on the last
// X-Forwarded-For hop. A flow that signs in from its own address never
// spends the budget the setup project and the other workers share.
export function ownIp(): string {
  const [a, b, c] = randomBytes(3)
  return `10.${a}.${b}.${c}`
}

// Login, waiting out throttling.
//
// Login is limited to 5 per minute per IP; wait once when throttled.
export async function login(email: string, password: string, ip?: string): Promise<Tokens> {
  const body = JSON.stringify({ email, password })
  let res = await call("/auth/login", { method: "POST", body, ip })
  if (res.status === 429) {
    const wait = Number(res.headers.get("retry-after") ?? "60")
    await new Promise((r) => setTimeout(r, (wait + 1) * 1000))
    res = await call("/auth/login", { method: "POST", body, ip })
  }
  await expectOk(res, `login ${email}`)
  return (await res.json()) as Tokens
}

// Policy-compliant random password.
//
// Has an upper case letter, a digit and a symbol.
export function generatePassword(): string {
  return `E2e!${randomBytes(9).toString("base64url")}7`
}

export async function findUser(admin: string, email: string): Promise<User> {
  const res = await expectOk(
    await call(`/users?q=${encodeURIComponent(email)}`, { token: admin }),
    `find ${email}`,
  )
  const match = ((await res.json()) as User[]).find((u) => u.email === email)
  if (!match) throw new Error(`user ${email} exists but was not found`)
  return match
}

// Create or reactivate a user.
//
// A reactivated user gets its password reset.
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

// Removal means deactivation.
//
// The API has no user delete.
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
