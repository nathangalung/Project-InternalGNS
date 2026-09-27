import { expect, test } from "./fixtures"

// Menus from the keyboard.
//
// The Base UI dropdown menus in a real browser: arrow keys and Enter pick,
// Escape closes and returns focus to the trigger, and an open menu locks no
// scroll, so the page behind it behaves as it did with the old panels.

test("the Grafik year menu picks a year by keyboard", async ({ page }) => {
  await page.goto("/")
  const current = String(new Date().getFullYear())
  const trigger = page.getByRole("main").getByRole("button", { name: `Grafik: ${current}` })

  await trigger.focus()
  await page.keyboard.press("ArrowDown")
  const menu = page.getByRole("menu")
  await expect(menu).toBeVisible()
  await expect(menu.getByRole("menuitemradio", { name: `Tahun ${current}` })).toHaveAttribute(
    "aria-checked",
    "true",
  )
  await page.keyboard.press("Escape")
  await expect(menu).toHaveCount(0)
  await expect(trigger).toBeFocused()

  await page.keyboard.press("ArrowDown")
  await page.keyboard.press("End")
  await page.keyboard.press("Enter")
  await expect(page.getByRole("main").getByRole("button", { name: "Grafik: 2024" })).toBeFocused()
})

test("the page-size menu picks a size and leaves the page scrollable", async ({ page }) => {
  await page.goto("/quotations")
  const main = page.getByRole("main")
  const trigger = main.getByRole("button", { name: /^\d+ Baris$/ })
  await expect(trigger).toHaveText("10 Baris")

  await trigger.click()
  const menu = page.getByRole("menu")
  await expect(menu.getByRole("menuitemradio")).toHaveText(["5 Baris", "10 Baris", "15 Baris"])
  const locks = await page.evaluate(() => [
    document.body.getAttribute("style"),
    getComputedStyle(document.querySelector("main") as HTMLElement).overflowY,
  ])
  expect(locks).toEqual([null, "auto"])

  // An outside press closes it
  await main.getByRole("heading", { level: 1 }).click()
  await expect(menu).toHaveCount(0)

  await trigger.focus()
  await page.keyboard.press("ArrowDown")
  await page.keyboard.press("Home")
  await page.keyboard.press("Enter")
  await expect(trigger).toHaveText("5 Baris")
  await expect(trigger).toBeFocused()
  await expect(main.locator("tbody tr")).toHaveCount(5)
})
