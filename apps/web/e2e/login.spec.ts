import type { Page } from "@playwright/test"
import { test as base, expect, savedTokens } from "./fixtures"
import { call, generatePassword, ownIp } from "./support/api"
import { baseURL } from "./support/env"
import { createUser, resetPassword, type SeedUser, setUser, uniqueTag } from "./support/finance"
import { isolateIp, signedInContext, submitLogin } from "./support/session"

// Form login and logout.
//
// Every test signs in from its own client address and, when it needs a real
// account, a throwaway user, so no failed attempt can throttle or lock the
// accounts the other specs share.

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
  await page.getByLabel("Email").fill("bukan-email")
  await page.getByLabel("Kata Sandi", { exact: true }).fill("Sembarang1!")
  await expect(page.getByText("Format email tidak valid.")).toBeVisible()
  await expect(page.getByRole("button", { name: "Masuk" })).toBeDisabled()
  expect(sent).toBe(false)
})

// Sign-in is a lookup.
//
// Accounts made under the older rule can hold an address the shared write
// rule refuses, such as a one-letter top-level label. The form must still
// send it and show the server's answer.
test("an address the write rule refuses still reaches the server", async ({ page }) => {
  const email = `${uniqueTag().toLowerCase()}@x.c`
  await page.getByLabel("Email").fill(email)
  await expect(page.getByText("Format email tidak valid.")).toHaveCount(0)
  expect((await submitLogin(page, email, "Sembarang1!")).status()).toBe(401)
  await expect(page.getByText(WRONG)).toBeVisible()
})

test("the eleventh attempt in a minute is throttled with a readable message (AU-7)", async ({
  page,
}) => {
  // An unknown address, so the per-account backoff never takes part.
  const email = `${uniqueTag().toLowerCase()}@globalsakti.com`
  for (let i = 0; i < 10; i++) {
    expect((await submitLogin(page, email, "Salah123!")).status()).toBe(401)
    await expect(page.getByText(WRONG)).toBeVisible()
  }
  expect((await submitLogin(page, email, "Salah123!")).status()).toBe(429)
  await expect(page.getByText(THROTTLED)).toBeVisible()
  await expect(page.getByText(/Unexpected token|JSON/)).toHaveCount(0)
})

// Nine misses, over two addresses.
//
// The rate limit allows ten per address and account per minute; the
// account counter sees all nine, and from the fifth on each attempt pays a growing delay.
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

// One submit's status and time.
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

// Pathname only, API side.
const apiPath = (url: string) => new URL(url).pathname.match(/\/api\/v1(\/.*)$/)?.[1]

test("an expired access token is renewed without a trip to the login page", async ({
  browser,
  user,
}) => {
  const { context, page } = await signedInContext(browser, user)
  try {
    // The first invoice list goes out with a token the API refuses.
    let forged = false
    await page.route(
      (url) => apiPath(url.href) === "/invoices",
      async (route) => {
        if (forged) return route.continue()
        forged = true
        const headers = { ...route.request().headers(), authorization: "Bearer kedaluwarsa" }
        await route.continue({ headers })
      },
    )
    const refused = page.waitForResponse(
      (r) => apiPath(r.url()) === "/invoices" && r.status() === 401,
    )
    const replayed = page.waitForResponse(
      (r) => apiPath(r.url()) === "/invoices" && r.status() === 200,
    )
    await page.goto("/invoices")
    await refused
    await replayed
    await expect(page.getByRole("heading", { name: "Daftar Invoice" })).toBeVisible()
    await expect(page).toHaveURL(/\/invoices$/)
  } finally {
    await context.close()
  }
})

test("signing out ends the session and its refresh cookie", async ({ browser, user }) => {
  const { context, page } = await signedInContext(browser, user)
  try {
    await page.goto("/")
    await expect(page.getByRole("heading", { name: "Dashboard Utama" })).toBeVisible()
    const cookie = (await context.cookies()).find((c) => c.name === "gns_refresh")
    expect(cookie).toBeTruthy()

    await page.getByRole("button", { name: "Keluar" }).click()
    await expect(page).toHaveURL(/\/login$/)
    // The logout answer expires the cookie in the browser.
    await expect
      .poll(async () => (await context.cookies()).some((c) => c.name === "gns_refresh"))
      .toBe(false)
    await page.goto("/invoices")
    await expect(page).toHaveURL(/\/login$/)

    // Replayed by hand, the old cookie is dead on the server too.
    const res = await call("/auth/refresh", {
      method: "POST",
      ip: ownIp(),
      headers: {
        cookie: `gns_refresh=${cookie?.value}`,
        origin: new URL(baseURL).origin,
        "X-GNS-CSRF": "1",
      },
    })
    expect(res.status).toBe(401)
  } finally {
    await context.close()
  }
})
