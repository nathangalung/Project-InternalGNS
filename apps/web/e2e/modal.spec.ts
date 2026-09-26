import type { Page } from "@playwright/test"
import { expect, test } from "./fixtures"

// Modal shell guarantees.
//
// The shared Modal on the Base UI dialog, driven by keyboard and pointer in
// a real browser: focus trap both ways, Escape, backdrop click, focus return
// to the opener, and the scroll lock on <main>. Stacking is covered by
// Modal.hook.test.tsx, since no screen opens two modals at once.

async function openFilter(page: Page, by: "keyboard" | "mouse") {
  await page.goto("/clients")
  const opener = page.getByRole("main").getByRole("button", { name: "Filter", exact: true })
  if (by === "keyboard") {
    await opener.focus()
    await page.keyboard.press("Enter")
  } else {
    await opener.click()
  }
  const dialog = page.getByRole("dialog", { name: "Filter Klien" })
  await expect(dialog).toBeVisible()
  return { opener, dialog }
}

// Focus is inside the dialog.
function focusInside(page: Page) {
  return page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]')
    return !!dialog?.contains(document.activeElement)
  })
}

test("keyboard focus stays inside the modal in both directions", async ({ page }) => {
  const { dialog } = await openFilter(page, "keyboard")
  await expect(dialog).toHaveAttribute("aria-modal", "true")
  await expect.poll(() => focusInside(page)).toBe(true)
  const stops = await dialog.locator("button:visible, input:visible").count()
  for (const key of ["Tab", "Shift+Tab"]) {
    for (let i = 0; i < stops + 2; i++) {
      await page.keyboard.press(key)
      await expect.poll(() => focusInside(page), { message: `${key} #${i + 1}` }).toBe(true)
    }
  }
})

test("Escape closes the modal, unlocks main and returns focus", async ({ page }) => {
  const { opener, dialog } = await openFilter(page, "keyboard")
  // aria-hidden while the modal is open, so not by role
  const main = page.locator("main")
  await expect(main).toHaveCSS("overflow-y", "hidden")
  await page.keyboard.press("Escape")
  await expect(dialog).toBeHidden()
  await expect(opener).toBeFocused()
  await expect(main).not.toHaveCSS("overflow-y", "hidden")
})

test("a backdrop click and the Tutup button close the modal", async ({ page }) => {
  const first = await openFilter(page, "mouse")
  await page.mouse.click(8, 8)
  await expect(first.dialog).toBeHidden()

  const second = await openFilter(page, "mouse")
  await second.dialog.getByRole("button", { name: "Tutup" }).click()
  await expect(second.dialog).toBeHidden()
  await expect(second.opener).toBeFocused()
})
