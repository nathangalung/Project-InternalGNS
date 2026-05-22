/**
 * Lighthouse CI puppeteer fixture.
 * Authenticates once via real API, then seeds sessionStorage on each page
 * so TanStack Router _authed.beforeLoad passes /auth/me check.
 */

const API_URL = process.env.LHCI_API_URL || "http://127.0.0.1:8080/api/v1"
const EMAIL = process.env.LHCI_EMAIL || "admin@globalsakti.com"
const PASSWORD = process.env.LHCI_PASSWORD || "AdminGNS123!"

let cachedTokens = null

async function fetchTokens() {
  if (cachedTokens) return cachedTokens
  const res = await fetch(`${API_URL}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`login failed ${res.status}: ${body}`)
  }
  const data = await res.json()
  cachedTokens = { token: data.token, refreshToken: data.refreshToken }
  return cachedTokens
}

module.exports = async (browser, context) => {
  if (context.url.endsWith("/login")) return

  const tokens = await fetchTokens()
  const page = await browser.newPage()
  const origin = new URL(context.url).origin
  await page.goto(`${origin}/login`, { waitUntil: "domcontentloaded" })
  await page.evaluate(
    (t, r) => {
      sessionStorage.setItem("gns_token", t)
      if (r) sessionStorage.setItem("gns_refresh_token", r)
      sessionStorage.setItem("gns_auth", "true")
    },
    tokens.token,
    tokens.refreshToken || "",
  )
  await page.close()
}
