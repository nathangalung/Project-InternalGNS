import { readFileSync } from "node:fs"
import { type BrowserContext, test as base } from "@playwright/test"
import type { Tokens } from "./support/api"
import { authFile, type Role } from "./support/env"

export { expect } from "@playwright/test"

export type Session = Role | "anonymous"

// Tokens the setup project saved.
export function savedTokens(role: Role): Tokens {
  return JSON.parse(readFileSync(authFile(role), "utf8")) as Tokens
}

// Signs every new tab in.
//
// Seeds once per tab, so a logout inside the test is not undone on reload.
export async function seedSession(context: BrowserContext, tokens: Tokens): Promise<void> {
  await context.addInitScript((t: Tokens) => {
    if (sessionStorage.getItem("gns_e2e_seeded")) return
    sessionStorage.setItem("gns_e2e_seeded", "1")
    sessionStorage.setItem("gns_token", t.token)
    if (t.refreshToken) sessionStorage.setItem("gns_refresh_token", t.refreshToken)
    sessionStorage.setItem("gns_auth", "true")
  }, tokens)
}

// Pages start signed in.
//
// The role is `session`; override it with test.use({ session }).
export const test = base.extend<{ session: Session }>({
  session: ["superadmin", { option: true }],
  context: async ({ context, session }, use) => {
    if (session !== "anonymous") await seedSession(context, savedTokens(session))
    await use(context)
  },
})
