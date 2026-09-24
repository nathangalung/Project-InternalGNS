import type { Browser, BrowserContext, Page, Response } from "@playwright/test"
import { seedSession } from "../fixtures"
import { login, ownIp } from "./api"
import { baseURL } from "./env"

// Browser sessions for throwaway users. Each context signs in from its own
// client address, so login and password-change limits never spill over to
// the setup project or another worker.

// Own address for every request.
export async function isolateIp(context: BrowserContext): Promise<string> {
  const ip = ownIp()
  await context.setExtraHTTPHeaders({ "x-forwarded-for": ip })
  return ip
}

// Submits the login form.
//
// Resolves with the API answer, so a caller can wait out each attempt.
export async function submitLogin(page: Page, email: string, password: string): Promise<Response> {
  await page.getByLabel("Surel").fill(email)
  await page.getByLabel("Kata Sandi", { exact: true }).fill(password)
  const response = page.waitForResponse((r) => r.url().endsWith("/auth/login"))
  await page.getByRole("button", { name: "Masuk" }).click()
  return response
}

// A second, already signed-in reader.
export async function signedInContext(
  browser: Browser,
  user: { email: string; password: string },
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    baseURL,
    locale: "id-ID",
    timezoneId: "Asia/Jakarta",
  })
  const ip = await isolateIp(context)
  await seedSession(context, await login(user.email, user.password, ip))
  return { context, page: await context.newPage() }
}
