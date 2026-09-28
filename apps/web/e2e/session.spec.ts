import type { BrowserContext, Page } from "@playwright/test"
import { expect, test } from "./fixtures"

// Cookie sessions across reloads and tabs.
//
// The access token lives in memory, so every page load restores it from the
// HttpOnly refresh cookie, and the tabs of one browser share that cookie.

const HOME = "Dashboard Utama"

// Refreshes the API refused.
function refusedRefreshes(context: BrowserContext): number[] {
  const refused: number[] = []
  context.on("response", (r) => {
    if (r.url().endsWith("/auth/refresh") && r.status() !== 200) refused.push(r.status())
  })
  return refused
}

async function openAt(page: Page, path: string, heading: string) {
  await page.goto(path)
  await expect(page.getByRole("heading", { name: heading })).toBeVisible()
}

test("a reload keeps the session", async ({ page, context }) => {
  const refused = refusedRefreshes(context)
  await openAt(page, "/", HOME)
  const restored = page.waitForResponse((r) => r.url().endsWith("/auth/refresh"))
  await page.reload()
  expect((await restored).status()).toBe(200)
  await expect(page.getByRole("heading", { name: HOME })).toBeVisible()
  await expect(page).toHaveURL(/\/$/)
  expect(refused).toEqual([])
})

test("a second tab shares the session without signing the first out", async ({ page, context }) => {
  const refused = refusedRefreshes(context)
  await openAt(page, "/", HOME)
  const second = await context.newPage()
  await openAt(second, "/clients", "Daftar Klien")

  // Both restore at once: the lock makes them rotate one after the other.
  await Promise.all([page.reload(), second.reload()])
  await expect(page.getByRole("heading", { name: HOME })).toBeVisible()
  await expect(second.getByRole("heading", { name: "Daftar Klien" })).toBeVisible()

  // The first tab still reaches the API.
  await openAt(page, "/invoices", "Daftar Invoice")
  expect(refused).toEqual([])
})

test("signing out in one tab ends the other on its next request", async ({ page, context }) => {
  await openAt(page, "/", HOME)
  const second = await context.newPage()
  await openAt(second, "/clients", "Daftar Klien")

  await page.getByRole("button", { name: "Keluar" }).click()
  await expect(page).toHaveURL(/\/login$/)

  // Told by the first tab, the second leaves its shell.
  await expect(second).toHaveURL(/\/login$/)
  await second.goto("/invoices")
  await expect(second).toHaveURL(/\/login$/)
  await expect(second.getByRole("heading", { name: "Halo!" })).toBeVisible()
})

test("the refresh token is never readable by the page", async ({ page, context }) => {
  await openAt(page, "/", HOME)
  // An older build's tokens, left in sessionStorage.
  await page.evaluate(() => {
    sessionStorage.setItem("gns_token", "warisan")
    sessionStorage.setItem("gns_refresh_token", "warisan-r")
    sessionStorage.setItem("gns_auth", "true")
  })
  const bearers: string[] = []
  page.on("request", (r) => {
    const auth = r.headers().authorization
    if (auth) bearers.push(auth)
  })
  const restored = page.waitForResponse((r) => r.url().endsWith("/auth/refresh"))
  await page.reload()
  const { token } = (await (await restored).json()) as { token: string }
  await expect(page.getByRole("heading", { name: HOME })).toBeVisible()
  expect(bearers).not.toContain("Bearer warisan")

  const cookie = (await context.cookies()).find((c) => c.name === "gns_refresh")
  expect(cookie).toMatchObject({
    httpOnly: true,
    sameSite: "Strict",
    path: "/api/v1/auth",
    expires: -1,
  })
  const seen = await page.evaluate(() => {
    const dump = (s: Storage) =>
      Array.from({ length: s.length }, (_, i) => s.key(i) ?? "").flatMap((k) => [
        k,
        s.getItem(k) ?? "",
      ])
    return {
      cookie: document.cookie,
      storage: [...dump(sessionStorage), ...dump(localStorage)],
    }
  })
  expect(seen.cookie).not.toContain("gns_refresh")
  expect(seen.cookie).not.toContain(cookie?.value)
  expect(seen.storage.filter((v) => v.startsWith("gns_"))).toEqual([])
  for (const secret of [cookie?.value ?? "", token]) {
    expect(secret).not.toBe("")
    expect(seen.storage.some((v) => v.includes(secret))).toBe(false)
  }
})
