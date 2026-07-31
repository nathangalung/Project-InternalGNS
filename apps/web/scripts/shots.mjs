// Login once, screenshot each path. Usage: bun scripts/shots.mjs <label> <path...>
import { chromium } from "playwright"
const label = process.argv[2]
const paths = process.argv.slice(3)
const D = process.env.SHOTDIR
const base = "http://localhost:5174"
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()
await page.goto(base + "/login", { waitUntil: "networkidle", timeout: 30000 })
await page.locator('input[type=email], input[placeholder*="nama"]').first().fill("admin@globalsakti.com")
await page.locator('input[type=password]').first().fill("AdminGNS123!")
await page.getByRole("button", { name: /masuk/i }).click()
await page.waitForURL((u) => !String(u).includes("/login"), { timeout: 20000 })
await page.waitForTimeout(1200)
for (const p of paths) {
  const name = (p.replace(/[/?=&]/g, "_") || "_root")
  await page.goto(base + p, { waitUntil: "networkidle", timeout: 30000 })
  await page.waitForTimeout(1200)
  await page.screenshot({ path: `${D}/${label}${name}.png`, fullPage: true })
  console.log("shot:", p)
}
await browser.close()
console.log("done")
