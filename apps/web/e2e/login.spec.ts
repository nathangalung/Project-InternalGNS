import type { Page } from "@playwright/test"
import { test as base, expect, savedTokens } from "./fixtures"
import { call, generatePassword, ownIp } from "./support/api"
import { createUser, resetPassword, type SeedUser, setUser, uniqueTag } from "./support/finance"
import { isolateIp, signedInContext, submitLogin } from "./support/session"

// Login and logout through the form. Every test signs in from its own client
// address and, when it needs a real account, a throwaway user, so no failed
// attempt can throttle or lock the accounts the other specs share.

const WRONG = "Email atau kata sandi salah."
const THROTTLED = "Terlalu banyak percobaan. Tunggu sebentar lalu coba lagi."

const test = base.extend<{ admin: string; user: SeedUser }>({
  // biome-ignore lint/correctness/noEmptyPattern: Playwright needs the destructured argument
  admin: async ({}, use) => use(savedTokens("superadmin").token),
  user: async ({ admin }, use) => {
    const user = await createUser(admin, "finance", uniqueTag())
    await use(user)
    await setUser(admin, user, { isActive: false })
  },
})

test.use({ session: "anonymous" })

test.beforeEach(async ({ context, page }) => {
  await isolateIp(context)
  await page.goto("/login")
})

test("a wrong password is named as such, not as an expired session (AU-4)", async ({
  page,
  user,
}) => {
  expect((await submitLogin(page, user.email, `${user.password}x`)).status()).toBe(401)
  await expect(page.getByText(WRONG)).toBeVisible()
  await expect(page.getByText(/Sesi berakhir/)).toHaveCount(0)
  await expect(page).toHaveURL(/\/login$/)
})

test("a malformed email is caught before any request", async ({ page }) => {
  let sent = false
  page.on("request", (req) => {
    if (req.url().endsWith("/auth/login")) sent = true
  })
  await page.getByLabel("Surel").fill("bukan-email")
  await page.getByLabel("Kata Sandi", { exact: true }).fill("Sembarang1!")
  await expect(page.getByText("Format surel tidak valid")).toBeVisible()
  await expect(page.getByRole("button", { name: "Masuk" })).toBeDisabled()
  expect(sent).toBe(false)
})

test("the sixth attempt in a minute is throttled with a readable message (AU-7)", async ({
  page,
}) => {
  // An unknown address, so the per-account lockout never takes part.
  const email = `${uniqueTag().toLowerCase()}@globalsakti.com`
  for (let i = 0; i < 5; i++) {
    expect((await submitLogin(page, email, "Salah123!")).status()).toBe(401)
    await expect(page.getByText(WRONG)).toBeVisible()
  }
  expect((await submitLogin(page, email, "Salah123!")).status()).toBe(429)
  await expect(page.getByText(THROTTLED)).toBeVisible()
  await expect(page.getByText(/Unexpected token|JSON/)).toHaveCount(0)
})

// Nine misses, over two addresses.
//
// The rate limit allows five per address per minute; the account counter
// sees all nine, and from the fifth on each attempt pays a growing delay.
async function missNineTimes(user: SeedUser) {
  for (const [ip, tries] of [
    [ownIp(), 5],
    [ownIp(), 4],
  ] as const) {
    for (let i = 0; i < tries; i++) {
      const res = await call("/auth/login", {
        method: "POST",
        ip,
        body: JSON.stringify({ email: user.email, password: `${user.password}x` }),
      })
      expect(res.status).toBe(401)
    }
  }
}

// Status and server time of one submit.
//
// Read from the browser's own request timing, so the figure is the wait the
// API imposed and not the test's scheduling.
async function timedLogin(page: Page, email: string, password: string) {
  const res = await submitLogin(page, email, password)
  return { status: res.status(), ms: res.request().timing().responseStart }
}

test("repeated misses slow the next attempt but never lock the owner out", async ({
  page,
  user,
}) => {
  test.slow()
  await missNineTimes(user)
  // Nine misses cost the next attempt four seconds; a hard lock would 401.
  const { status, ms } = await timedLogin(page, user.email, user.password)
  expect(status).toBe(200)
  expect(ms).toBeGreaterThan(3_500)
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByText(user.name, { exact: true })).toBeVisible()
})

test("an admin password reset clears the miss count (AU-8)", async ({ page, admin, user }) => {
  test.slow()
  await missNineTimes(user)
  const fresh = generatePassword()
  await resetPassword(admin, user.id, fresh)
  const { status, ms } = await timedLogin(page, user.email, fresh)
  expect(status).toBe(200)
  expect(ms).toBeLessThan(2_500)
  await expect(page).toHaveURL(/\/$/)
})

test("signing out ends the session and its refresh token", async ({ browser, user }) => {
  const { context, page } = await signedInContext(browser, user)
  try {
    await page.goto("/")
    await expect(page.getByRole("heading", { name: "Dashboard Utama" })).toBeVisible()
    const refreshToken = await page.evaluate(() => sessionStorage.getItem("gns_refresh_token"))
    expect(refreshToken).toBeTruthy()

    await page.getByRole("button", { name: "Keluar" }).click()
    await expect(page).toHaveURL(/\/login$/)
    await page.goto("/invoices")
    await expect(page).toHaveURL(/\/login$/)

    const res = await call("/auth/refresh", {
      method: "POST",
      ip: ownIp(),
      body: JSON.stringify({ refreshToken }),
    })
    expect(res.status).toBe(401)
  } finally {
    await context.close()
  }
})
