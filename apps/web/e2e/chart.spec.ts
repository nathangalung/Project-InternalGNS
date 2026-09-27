import type { Locator, Page } from "@playwright/test"
import { expect, test } from "./fixtures"

// Trend chart from the keyboard.
//
// Tab lands on one data point, the arrow keys walk the months, and the
// focused point shows the pointer's tooltip. Its name and the hidden data
// table carry the same value. Figures move while parallel specs file
// documents, so values are compared within the page, never to constants.

const SCREENS = [
  { path: "/", heading: "Tren Performa" },
  { path: "/dashboard-financial", heading: "Tren Performa Finansial" },
] as const

function chartPanel(page: Page, heading: string): Locator {
  return page
    .getByRole("main")
    .locator("div")
    .filter({ has: page.getByRole("heading", { name: heading, exact: true }) })
    .filter({ has: page.getByRole("group", { name: /^Grafik / }) })
    .last()
}

async function tooltip(chart: Locator): Promise<string[]> {
  return chart.locator('[data-slot="chart-tooltip"] text').allTextContents()
}

for (const { path, heading } of SCREENS) {
  test(`the ${path} trend chart reads each value by keyboard`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 })
    await page.goto(path)
    const panel = chartPanel(page, heading)
    const chart = panel.getByRole("group", { name: /^Grafik / })
    await expect(chart).toBeVisible()
    const tabs = panel.getByRole("button", { pressed: true })
    const activeKey = (await tabs.textContent())?.trim() ?? ""

    // One tab stop, on the first month
    await panel.getByRole("button").last().focus()
    await page.keyboard.press("Tab")
    const jan = chart.getByRole("img", { name: new RegExp(`^JAN, ${escapeRegExp(activeKey)}: `) })
    await expect(jan).toBeFocused()
    await expect(jan.locator("circle").first()).toHaveCSS("opacity", "1")

    const [month, label, value] = await tooltip(chart)
    expect([month, label]).toEqual(["JAN", activeKey])
    await expect(jan).toHaveAttribute("aria-label", `JAN, ${activeKey}: ${value}`)
    const table = page.getByRole("table", { name: `Data Grafik ${activeKey} per periode` })
    await expect(table.getByRole("row").nth(1)).toHaveText(`JAN${value}`)

    await page.keyboard.press("ArrowRight")
    await expect(chart.getByRole("img", { name: /^FEB, / })).toBeFocused()
    expect((await tooltip(chart))[0]).toBe("FEB")
    await page.keyboard.press("End")
    await expect(chart.getByRole("img", { name: /^DES, / })).toBeFocused()
    const [, , decValue] = await tooltip(chart)
    await expect(table.getByRole("row").last()).toHaveText(`DES${decValue}`)

    await page.keyboard.press("Escape")
    await expect(chart.locator('[data-slot="chart-tooltip"]')).toHaveCount(0)
    await expect(chart.getByRole("img", { name: /^DES, / })).toBeFocused()

    // Tab leaves the chart
    await page.keyboard.press("Tab")
    expect(await chart.evaluate((el) => el.contains(document.activeElement))).toBe(false)
    await page.keyboard.press("Shift+Tab")
    await expect(chart.getByRole("img", { name: /^DES, / })).toBeFocused()

    // The hidden table adds no scroll
    const extent = await page.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
    }))
    expect(extent).toEqual({ width: 320, height: 640 })
  })
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
