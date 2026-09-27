import { expect, test } from "./fixtures"

// Menus from the keyboard.
//
// The Base UI dropdown menus in a real browser: arrow keys and Enter pick,
// Escape closes and returns focus to the trigger.

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
