import { mkdir, writeFile } from "node:fs/promises"
import { test as setup } from "@playwright/test"
import { ensureUser, generatePassword, login } from "./support/api"
import { adminCredentials, authDir, authFile, e2eUsers } from "./support/env"

// One API login per role per run. The app keeps its tokens in
// sessionStorage, which Playwright storageState does not capture, so the
// tokens are saved here and the fixture seeds them into each page.
setup("sign in every role", async () => {
  // Room for one throttled login to wait out the rate-limit window.
  setup.setTimeout(150_000)
  const admin = adminCredentials()
  const adminTokens = await login(admin.email, admin.password)
  await mkdir(authDir, { recursive: true })
  await writeFile(authFile("superadmin"), JSON.stringify(adminTokens), { mode: 0o600 })

  for (const [role, user] of Object.entries(e2eUsers)) {
    const password = generatePassword()
    await ensureUser(adminTokens.token, { ...user, role }, password)
    const tokens = await login(user.email, password)
    await writeFile(authFile(role as keyof typeof e2eUsers), JSON.stringify(tokens), {
      mode: 0o600,
    })
  }
})
