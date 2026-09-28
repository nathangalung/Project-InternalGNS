import { expect, test } from "./fixtures"
import { sitePolicy, takeViolations, violations } from "./support/csp"
import { apiURL } from "./support/env"

// Content policy canaries.
//
// Only the CSP preview (bun run e2e:csp) serves the header. These prove the
// run is live: the served policy is production's, enforced, and a planted
// inline script is both refused and reported to the guard every other test
// fails on.
const underPolicy = process.env.E2E_CSP === "enforce"
const policy = sitePolicy(new URL(apiURL).origin)

test.describe("served under the production policy", () => {
  test.skip(!underPolicy, "needs the CSP preview: bun run e2e:csp")
  test.use({ session: "anonymous", cspGuard: false })

  for (const path of ["/login", "/quotations"]) {
    test(`${path} carries the enforcing header`, async ({ page }) => {
      const res = await page.goto(path)
      const headers = res?.headers() ?? {}
      expect(headers["content-security-policy"]).toBe(policy.policy)
      expect(headers["content-security-policy-report-only"]).toBeUndefined()
    })
  }

  test("an inline script is refused and reported", async ({ page }) => {
    await page.goto("/login")
    await expect(page.getByRole("button", { name: "Masuk" })).toBeVisible()
    takeViolations()
    const ran = await page.evaluate(async () => {
      const script = document.createElement("script")
      script.textContent = "document.documentElement.dataset.cspCanary = 'ran'"
      document.head.append(script)
      await new Promise((r) => setTimeout(r, 100))
      return document.documentElement.dataset.cspCanary === "ran"
    })
    expect(ran).toBe(false)
    await expect.poll(() => violations().some((v) => v.includes("script-src"))).toBe(true)
  })
})
