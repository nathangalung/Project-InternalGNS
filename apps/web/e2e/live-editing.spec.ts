import type { Browser, Page } from "@playwright/test"
import { savedTokens } from "./fixtures"
import { e2eUsers } from "./support/env"
import { expect, test } from "./support/seed"
import { signedInContext } from "./support/session"

// Live editing of one draft.
//
// Two users edit the same draft at once: each claims the line or header it
// opens, the other sees that part read-only with the editor's name, and
// every save reaches the other page without a reload.

const operationalName = e2eUsers.operational.name

// The operational editor, in its own browser.
async function secondEditor(browser: Browser): Promise<{ page: Page; close: () => Promise<void> }> {
  const { email, password } = savedTokens("operational")
  if (!email || !password) throw new Error("setup saved no operational credentials")
  const { context, page } = await signedInContext(browser, { email, password })
  return { page, close: () => context.close() }
}

async function toStep(page: Page, step: number): Promise<void> {
  const next = page.getByRole("button", { name: "Lanjut" })
  await expect(next).toBeEnabled()
  for (let i = 1; i < step; i++) await next.click()
}

test.describe("live quotation editing", () => {
  test("two editors change different lines at once and see each other live", async ({
    browser,
    page,
    seed,
  }) => {
    const client = await seed.client()
    const first = await seed.item()
    const second = await seed.item()
    const q = await seed.quotation({
      client,
      lines: [
        { item: first, qty: 1, price: 10_000 },
        { item: second, qty: 1, price: 20_000 },
      ],
    })
    const other = await secondEditor(browser)
    try {
      await page.goto(`/quotations/${q.id}/edit`)
      await toStep(page, 2)
      await other.page.goto(`/quotations/${q.id}/edit`)
      await toStep(other.page, 2)

      // The operational editor opens line 2; this page sees it taken.
      await other.page.getByRole("button", { name: "Edit produk 2" }).click()
      const theirs = other.page.getByRole("dialog", { name: "Edit Produk Quotation" })
      await expect(theirs).toBeVisible()
      await expect(page.getByText(`Sedang diedit oleh ${operationalName}`)).toBeVisible()
      await expect(page.getByRole("button", { name: "Edit produk 2" })).toBeDisabled()
      await expect(page.getByRole("button", { name: "Hapus produk 2" })).toBeDisabled()

      // Line 1 stays free: this page edits it while line 2 is open.
      await page.getByRole("button", { name: "Edit produk 1" }).click()
      const mine = page.getByRole("dialog", { name: "Edit Produk Quotation" })
      await mine.getByLabel("Jumlah Produk *").fill("6")
      await mine.getByRole("button", { name: "Simpan Perubahan" }).click()
      await expect(mine).toBeHidden()

      await theirs.getByLabel("Jumlah Produk *").fill("9")
      await theirs.getByRole("button", { name: "Simpan Perubahan" }).click()
      await expect(theirs).toBeHidden()

      // Both saves land, and each page shows the other's without a reload.
      await expect
        .poll(async () =>
          (await seed.getQuotation(q.id)).items
            .filter((it) => it.itemType === "product")
            .map((it) => Number(it.qty)),
        )
        .toEqual([6, 9])
      await expect(page.getByText(`Sedang diedit oleh ${operationalName}`)).toHaveCount(0)
      await expect(page.getByRole("button", { name: "Edit produk 2" })).toBeEnabled()
      for (const p of [page, other.page]) {
        await expect(p.locator("main")).toContainText("PRODUK 1")
        await expect.poll(() => p.locator("main").innerText()).toMatch(/\b6\b[\s\S]*\b9\b/)
      }
    } finally {
      await other.close()
    }
  })

  test("the header is edited by one person at a time", async ({ browser, page, seed }) => {
    const client = await seed.client()
    const item = await seed.item()
    const q = await seed.quotation({ client, lines: [{ item, qty: 1, price: 25_000 }] })
    const other = await secondEditor(browser)
    try {
      // The operational editor reaches the terms first and holds the header.
      await other.page.goto(`/quotations/${q.id}/edit`)
      await toStep(other.page, 4)
      await expect(other.page.getByLabel(/BERLAKU SAMPAI/)).toBeEnabled()

      await page.goto(`/quotations/${q.id}/edit`)
      await toStep(page, 4)
      await expect(
        page.getByText(
          `Pengiriman, tenggat waktu dan diskon sedang diubah oleh ${operationalName}`,
        ),
      ).toBeVisible()
      await expect(page.getByLabel(/BERLAKU SAMPAI/)).toBeDisabled()

      // Their save frees the header, and this page takes it with their value.
      await other.page.getByLabel(/BERLAKU SAMPAI/).fill("21")
      await other.page.getByRole("button", { name: "Simpan" }).click()
      await expect(other.page).toHaveURL(new RegExp(`/quotations/${q.id}$`), { timeout: 15_000 })
      await expect(page.getByLabel(/BERLAKU SAMPAI/)).toBeEnabled()
      await expect(page.getByLabel(/BERLAKU SAMPAI/)).toHaveValue("21")
      await expect.poll(async () => (await seed.getQuotation(q.id)).validityDays).toBe(21)
    } finally {
      await other.close()
    }
  })

  test("a change saved elsewhere shows up without a reload", async ({ page, seed }) => {
    const client = await seed.client()
    const item = await seed.item()
    const q = await seed.quotation({ client, lines: [{ item, qty: 1, price: 25_000 }] })

    await page.goto(`/quotations/${q.id}/edit`)
    await toStep(page, 2)
    await expect(page.locator("main")).toContainText("PRODUK 1")
    // Another user saves the whole draft while this editor is open.
    await seed.updateQuotation(q, {
      client,
      lines: [
        { item, qty: 1, price: 25_000 },
        { item, qty: 3, price: 30_000 },
      ],
      validityDays: 45,
    })
    await expect(page.locator("main")).toContainText("PRODUK 2")
    for (let i = 0; i < 2; i++) await page.getByRole("button", { name: "Lanjut" }).click()
    await expect(page.getByLabel(/BERLAKU SAMPAI/)).toHaveValue("45")
  })
})
