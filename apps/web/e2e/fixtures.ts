import { readFileSync } from "node:fs"
import { test as base } from "@playwright/test"
import type { Tokens } from "./support/api"
import { authFile, type Role } from "./support/env"

export { expect } from "@playwright/test"

export type Session = Role | "anonymous"

// Pages start signed in as `session`; override with test.use({ session }).
export const test = base.extend<{ session: Session }>({
  session: ["superadmin", { option: true }],
  context: async ({ context, session }, use) => {
    if (session !== "anonymous") {
      const tokens = JSON.parse(readFileSync(authFile(session), "utf8")) as Tokens
      // Seed once per tab, so a logout inside the test is not undone on reload.
      await context.addInitScript((t: Tokens) => {
        if (sessionStorage.getItem("gns_e2e_seeded")) return
        sessionStorage.setItem("gns_e2e_seeded", "1")
        sessionStorage.setItem("gns_token", t.token)
        if (t.refreshToken) sessionStorage.setItem("gns_refresh_token", t.refreshToken)
        sessionStorage.setItem("gns_auth", "true")
      }, tokens)
    }
    await use(context)
  },
})
