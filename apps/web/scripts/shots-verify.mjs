// Login once, capture migrated screens + a detail + open modals. Usage: bun scripts/shots-verify.mjs
import { chromium } from "playwright"

const D = process.env.SHOTDIR
const base = "http://localhost:5174"
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()
const errs = []
page.on("console", (m) => {
  if (m.type() === "error") errs.push(m.text())
})

async function shot(name) {
  await page.waitForTimeout(900)
  await page.screenshot({ path: `${D}/${name}.png`, fullPage: true })
  console.log("shot:", name)
}

// Login
await page.goto(`${base}/login`, { waitUntil: "networkidle", timeout: 30000 })
await page.locator('input[type=email], input[placeholder*="nama"]').first().fill("admin@globalsakti.com")
await page.locator("input[type=password]").first().fill("AdminGNS123!")
await page.getByRole("button", { name: /masuk/i }).click()
await page.waitForURL((u) => !String(u).includes("/login"), { timeout: 20000 })
await page.waitForTimeout(1500)

// Static migrated pages
const paths = [
  ["overview", "/"],
  ["dashboard-financial", "/dashboard-financial"],
  ["dashboard-operational", "/dashboard-operational"],
  ["clients", "/clients"],
  ["vendors", "/vendors"],
  ["products", "/products"],
  ["users", "/users"],
  ["quotations", "/quotations"],
  ["quotation-wizard", "/quotations/add"],
]
for (const [name, p] of paths) {
  await page.goto(base + p, { waitUntil: "networkidle", timeout: 30000 })
  await shot(name)
}

// Client detail via first row action
await page.goto(`${base}/clients`, { waitUntil: "networkidle", timeout: 30000 })
await page.waitForTimeout(1000)
const detailBtn = page.locator('[title="Lihat detail"]').first()
if (await detailBtn.count()) {
  await detailBtn.click()
  await page.waitForTimeout(1400)
  await shot("client-detail")
}

// Add-client modal
await page.goto(`${base}/clients`, { waitUntil: "networkidle", timeout: 30000 })
await page.waitForTimeout(800)
const addBtn = page.getByRole("button", { name: /tambah klien/i }).first()
if (await addBtn.count()) {
  await addBtn.click()
  await page.waitForTimeout(1000)
  await shot("client-add-modal")
  await page.keyboard.press("Escape")
}

// Filter modal
const filterBtn = page.getByRole("button", { name: /filter/i }).first()
if (await filterBtn.count()) {
  await filterBtn.click()
  await page.waitForTimeout(900)
  await shot("client-filter-modal")
}

await browser.close()
console.log("console-errors:", errs.length)
for (const e of errs.slice(0, 10)) console.log("  ERR:", e)
console.log("done")
