import { chromium } from "playwright"
const url = process.argv[2]
const out = process.argv[3]
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.goto(url, { waitUntil: "networkidle", timeout: 30000 })
await page.screenshot({ path: out, fullPage: true })
await browser.close()
console.log("shot ok:", out)
