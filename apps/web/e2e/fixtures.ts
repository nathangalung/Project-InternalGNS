import { readFileSync } from "node:fs"
import { test as base, expect } from "@playwright/test"
import { ownIp, type Tokens } from "./support/api"
import { guardCsp, takeViolations } from "./support/csp"
import { adminCredentials, authFile, type Role } from "./support/env"
import { loginState, routeClientIp } from "./support/session"

export { expect }

export type Session = Role | "anonymous"

// What setup saved per role.
//
// An access token for API calls; the e2e users also keep their generated
// password, the superadmin's stays in the environment.
export type Saved = Tokens & { email?: string; password?: string }

export function savedTokens(role: Role): Saved {
  return JSON.parse(readFileSync(authFile(role), "utf8")) as Saved
}

function credentials(role: Role): { email: string; password: string } {
  if (role === "superadmin") return adminCredentials()
  const { email, password } = savedTokens(role)
  if (!email || !password) throw new Error(`setup saved no credentials for ${role}`)
  return { email, password }
}

// Pages start signed in.
//
// The role is `session`; override it with test.use({ session }). Every test
// context signs in for real and starts from that login's storageState, so it
// holds its own refresh cookie. One cookie saved per role would not do: the
// first page load rotates it, and any other context presenting the old one is
// a replay the API answers by revoking every session of that user. The
// context also gets its own client address, since login and refresh are
// limited per address and every page load now spends one refresh.
//
// Every context also records content-policy violations, and a test fails on
// any. Without a policy header nothing is refused, so this bites only under
// the CSP preview (playwright.csp.config.ts). A canary opts out with
// test.use({ cspGuard: false }) and reads the violations itself. The check
// is an auto fixture, so a test that builds its own context through
// signedInContext is held to it too.
export const test = base.extend<{
  session: Session
  clientIp: string
  cspGuard: boolean
  cspCheck: undefined
}>({
  session: ["superadmin", { option: true }],
  cspGuard: [true, { option: true }],
  cspCheck: [
    async ({ cspGuard }, use) => {
      takeViolations()
      await use(undefined)
      if (cspGuard) expect(takeViolations(), "content-policy violations").toEqual([])
    },
    { auto: true },
  ],
  context: async ({ context, clientIp }, use) => {
    await routeClientIp(context, clientIp)
    await guardCsp(context)
    await use(context)
  },
  // biome-ignore lint/correctness/noEmptyPattern: Playwright needs the destructured argument
  clientIp: async ({}, use) => use(ownIp()),
  storageState: async ({ session, clientIp }, use) => {
    if (session === "anonymous") return use(undefined)
    const { email, password } = credentials(session)
    await use(await loginState(email, password, clientIp))
  },
})
