import { mkdir, writeFile } from "node:fs/promises"
import { test as setup } from "@playwright/test"
import type { Saved } from "./fixtures"
import { ensureUser, generatePassword, login } from "./support/api"
import { adminCredentials, authDir, authFile, e2eUsers } from "./support/env"

// Prepare every role once.
//
// Creates or reactivates the e2e users and saves, per role, an access token
// for the specs' API calls plus the e2e users' generated passwords. Browser
// sessions are not saved here: each test context signs in on its own (see
// fixtures.ts), since contexts sharing one refresh cookie would replay it.
setup("sign in every role", async () => {
  // Room for one throttled login to wait out the rate-limit window.
  setup.setTimeout(150_000)
  const admin = adminCredentials()
  const adminTokens = await login(admin.email, admin.password)
  await mkdir(authDir, { recursive: true })
  // The admin password stays in the environment.
  const adminSaved: Saved = { token: adminTokens.token }
  await writeFile(authFile("superadmin"), JSON.stringify(adminSaved), { mode: 0o600 })

  for (const [role, user] of Object.entries(e2eUsers)) {
    const password = generatePassword()
    await ensureUser(adminTokens.token, { ...user, role }, password)
    const { token } = await login(user.email, password)
    const saved: Saved = { token, email: user.email, password }
    await writeFile(authFile(role as keyof typeof e2eUsers), JSON.stringify(saved), {
      mode: 0o600,
    })
  }
})
