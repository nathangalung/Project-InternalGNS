import {
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
  type Response,
  request,
} from "@playwright/test"
import { ownIp } from "./api"
import { guardCsp } from "./csp"
import { apiURL, baseURL } from "./env"

// Throwaway-user browser sessions.
//
// Each context signs in from its own client address, so login and
// password-change limits never spill over to the setup project or another
// worker.

export type StorageState = Awaited<ReturnType<APIRequestContext["storageState"]>>

// Client address on API requests.
//
// Added by interception, not as an extra header: a header the page itself
// sends to a cross-origin API has to pass CORS, and the API never allows
// X-Forwarded-For, which only its proxy writes. The newest route wins.
export async function routeClientIp(context: BrowserContext, ip: string): Promise<void> {
  await context.route(
    (url) => url.href.startsWith(apiURL),
    (route) => route.continue({ headers: { ...route.request().headers(), "x-forwarded-for": ip } }),
  )
}

// Own address for every request.
export async function isolateIp(context: BrowserContext): Promise<string> {
  const ip = ownIp()
  await routeClientIp(context, ip)
  return ip
}

// A real login, as storageState.
//
// The API answers with the refresh cookie on its own host, which is where
// the browser sends its refresh, so the state carries that cookie and
// nothing else. Login is limited to 5 per minute per address; wait once when
// throttled.
export async function loginState(
  email: string,
  password: string,
  ip: string,
): Promise<StorageState> {
  const api = await request.newContext({ extraHTTPHeaders: { "x-forwarded-for": ip } })
  try {
    const data = { email, password }
    let res = await api.post(`${apiURL}/auth/login`, { data })
    if (res.status() === 429) {
      const wait = Number(res.headers()["retry-after"] ?? "60")
      await new Promise((r) => setTimeout(r, (wait + 1) * 1000))
      res = await api.post(`${apiURL}/auth/login`, { data })
    }
    if (!res.ok()) throw new Error(`login ${email}: ${res.status()} ${await res.text()}`)
    return await api.storageState()
  } finally {
    await api.dispose()
  }
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
  const ip = ownIp()
  const context = await browser.newContext({
    baseURL,
    locale: "id-ID",
    timezoneId: "Asia/Jakarta",
    storageState: await loginState(user.email, user.password, ip),
  })
  await routeClientIp(context, ip)
  // The test's fixture asserts these.
  await guardCsp(context)
  return { context, page: await context.newPage() }
}
