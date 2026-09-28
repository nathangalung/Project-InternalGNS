/**
 * Lighthouse CI puppeteer fixture.
 * Signs in once per browser with a real login made inside Chrome, so the
 * API's HttpOnly refresh cookie lands in the browser's own jar. Each audited
 * page then restores its session from that cookie, as a reader's would.
 * LHCI reuses one browser for every URL, and Lighthouse's storage reset
 * leaves cookies alone. The /login URL is audited before any sign-in.
 */

const API_URL = process.env.LHCI_API_URL || "http://127.0.0.1:8080/api/v1"
const EMAIL = process.env.LHCI_EMAIL || "admin@globalsakti.com"
const PASSWORD = process.env.LHCI_PASSWORD || "AdminGNS123!"

const signedIn = new WeakSet()

// Credentialed login from the SPA origin.
async function login(page) {
  return page.evaluate(
    async (url, email, password) => {
      const res = await fetch(`${url}/auth/login`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      })
      return { status: res.status, retryAfter: res.headers.get("retry-after"), body: await res.text() }
    },
    API_URL,
    EMAIL,
    PASSWORD,
  )
}

module.exports = async (browser, context) => {
  if (context.url.endsWith("/login") || signedIn.has(browser)) return

  const page = await browser.newPage()
  try {
    await page.goto(`${new URL(context.url).origin}/login`, { waitUntil: "domcontentloaded" })
    let res = await login(page)
    // Login allows 5 per minute per address; wait once.
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, (Number(res.retryAfter || "60") + 1) * 1000))
      res = await login(page)
    }
    if (res.status !== 200) throw new Error(`login failed ${res.status}: ${res.body}`)
    signedIn.add(browser)
  } finally {
    await page.close()
  }
}
