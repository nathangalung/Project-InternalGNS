import { readFile, rm } from "node:fs/promises"
import { test as teardown } from "@playwright/test"
import { deactivateUser, type Tokens } from "./support/api"
import { authDir, authFile, e2eUsers } from "./support/env"

// Deactivate users, drop saved tokens.
teardown("remove e2e users", async () => {
  const saved = await readFile(authFile("superadmin"), "utf8").catch(() => null)
  // Setup failed before signing in: nothing was created.
  if (saved) {
    const admin = JSON.parse(saved) as Tokens
    for (const user of Object.values(e2eUsers)) {
      await deactivateUser(admin.token, user.email)
    }
  }
  await rm(authDir, { recursive: true, force: true })
})
