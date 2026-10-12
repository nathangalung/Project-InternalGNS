import type { Page } from "@playwright/test"
import type { SalesSeed } from "./support/sales"
import { expect, test } from "./support/seed"

// List state in the URL.
//
// A list keeps its search, filters, page and page size in its URL, so
// Kembali, a crumb, the back button and a reload open it as it was left,
// scrolled where the reader was. The menu opens it in its default state.

const SEARCH = "Cari penawaran, klien, atau nomor..."

// Twelve drafts and one cancelled.
//
// The Draf filter leaves twelve, three pages at five a page.
async function seedQuotations(seed: SalesSeed) {
  const client = await seed.client()
  const item = await seed.item()
  const lines = [{ item, qty: 1, price: 30_000 }]
  for (let i = 0; i < 12; i++) await seed.quotation({ client, lines })
  const dropped = await seed.quotation({ client, lines })
  await seed.setQuotationStatus(dropped.id, "cancelled", "Klien tidak jadi memesan")
  return client
}

function rows(page: Page, clientName: string) {
  return page.getByRole("row", { name: new RegExp(clientName) })
}

const main = (page: Page) => page.locator("main")
const scrollTop = (page: Page) => main(page).evaluate((el) => el.scrollTop)

// Search, Draf, five a page, page 2.
async function narrowList(page: Page, seed: SalesSeed, clientName: string) {
  await page.goto("/quotations")
  await page.getByPlaceholder(SEARCH).fill(seed.prefix)
  await expect(rows(page, clientName)).toHaveCount(10)

  await page.getByRole("button", { name: "Filter", exact: true }).click()
  const filter = page.getByRole("dialog", { name: "Filter Quotation" })
  await filter
    .getByRole("group", { name: "Status Quotation" })
    .getByRole("button", { name: "Draf" })
    .click()
  await filter.getByRole("button", { name: "Terapkan" }).click()

  await page.getByRole("button", { name: /^\d+ Baris$/ }).click()
  await page.getByRole("menuitemradio", { name: "5 Baris", exact: true }).click()
  await page.getByRole("button", { name: "2", exact: true }).click()
  await expect(page.getByText("Menampilkan 6-10 dari 12 Quotation")).toBeVisible()
}

// The list as narrowList left it.
async function expectNarrowed(page: Page, seed: SalesSeed, clientName: string) {
  await expect(page).toHaveURL(/\/quotations\?/)
  const search = new URL(page.url()).searchParams
  expect(search.get("q")).toBe(seed.prefix)
  expect(search.get("status")).toBe("draft")
  expect(search.get("per")).toBe("5")
  expect(search.get("page")).toBe("2")
  await expect(page.getByPlaceholder(SEARCH)).toHaveValue(seed.prefix)
  await expect(page.getByRole("button", { name: "Hapus filter Status: Draf" })).toBeVisible()
  await expect(page.getByRole("button", { name: "2", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  )
  await expect(rows(page, clientName)).toHaveCount(5)
  await expect(page.getByText("Menampilkan 6-10 dari 12 Quotation")).toBeVisible()
}

// Scroll main down and open a row.
async function scrollAndOpen(page: Page, clientName: string): Promise<number> {
  await main(page).evaluate((el) => el.scrollTo(0, el.scrollHeight))
  const top = await scrollTop(page)
  expect(top).toBeGreaterThan(0)
  await rows(page, clientName)
    .last()
    .getByRole("button", { name: /^Lihat / })
    .click()
  await expect(page).toHaveURL(/\/quotations\/\d+$/)
  // A new page starts at the top.
  await expect.poll(() => scrollTop(page)).toBe(0)
  return top
}

test.describe("list state", () => {
  // Short enough that five rows scroll main.
  test.use({ viewport: { width: 1280, height: 520 } })

  // The quotation page goes back by its crumb; the product page has Kembali.
  test("Kembali returns to the same filters, search, page and scroll", async ({ page, seed }) => {
    for (let i = 0; i < 12; i++) await seed.item()
    const search = page.getByPlaceholder("Cari kode IMPA, nama, kategori produk...")
    const shown = page.getByText(/^Menampilkan \d+-\d+ dari \d+ Produk$/)

    await page.goto("/products")
    await page.getByRole("button", { name: "Filter", exact: true }).click()
    const filter = page.getByRole("dialog", { name: "Filter Produk" })
    await filter.getByRole("button", { name: "Aktif", exact: true }).click()
    await filter.getByRole("button", { name: "Terapkan" }).click()
    await search.fill(seed.prefix)
    await expect(page.getByRole("row", { name: /EXACT|MIRIP|FUZZY/ }).first()).toBeVisible()
    await page.getByRole("button", { name: /^\d+ Baris$/ }).click()
    await page.getByRole("menuitemradio", { name: "5 Baris", exact: true }).click()
    await page.getByRole("button", { name: "2", exact: true }).click()
    await expect(shown).toHaveText(/^Menampilkan 6-10 /)
    const shownText = await shown.textContent()

    await main(page).evaluate((el) => el.scrollTo(0, el.scrollHeight))
    const top = await scrollTop(page)
    expect(top).toBeGreaterThan(0)
    await page
      .getByRole("button", { name: /^Lihat detail / })
      .last()
      .click()
    await expect(page).toHaveURL(/\/products\/\d+$/)
    await expect.poll(() => scrollTop(page)).toBe(0)

    await page.getByRole("button", { name: "Kembali ke Katalog Produk" }).click()
    await expect(page).toHaveURL(/\/products\?/)
    const params = new URL(page.url()).searchParams
    expect(Object.fromEntries(params)).toEqual({
      status: "active",
      q: seed.prefix,
      page: "2",
      per: "5",
    })
    await expect(search).toHaveValue(seed.prefix)
    await expect(page.getByRole("button", { name: "Hapus filter Status: Aktif" })).toBeVisible()
    await expect(page.getByRole("button", { name: "2", exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    )
    await expect(shown).toHaveText(shownText ?? "")
    await expect.poll(() => scrollTop(page)).toBe(top)
  })

  test("a crumb and the back button restore the list the same way", async ({ page, seed }) => {
    const client = await seedQuotations(seed)
    await narrowList(page, seed, client.name)
    const top = await scrollAndOpen(page, client.name)

    await page
      .getByRole("navigation", { name: "Breadcrumb" })
      .getByRole("link", { name: "Daftar Quotation" })
      .click()
    await expectNarrowed(page, seed, client.name)
    await expect.poll(() => scrollTop(page)).toBe(top)

    await scrollAndOpen(page, client.name)
    await page.goBack()
    await expectNarrowed(page, seed, client.name)
    await expect.poll(() => scrollTop(page)).toBe(top)
  })

  test("a reload keeps the list state", async ({ page, seed }) => {
    const client = await seedQuotations(seed)
    await narrowList(page, seed, client.name)
    await page.reload()
    await expectNarrowed(page, seed, client.name)
  })

  test("typing replaces the history entry instead of adding one per key", async ({
    page,
    seed,
  }) => {
    const client = await seedQuotations(seed)
    await page.goto("/")
    await page.getByRole("link", { name: "Quotation", exact: true }).click()
    await page.getByPlaceholder(SEARCH).pressSequentially(seed.prefix, { delay: 20 })
    await expect(rows(page, client.name)).toHaveCount(10)
    await page.getByRole("button", { name: "2", exact: true }).click()
    await expect(page).toHaveURL(/page=2/)

    await page.goBack()
    await expect(page).toHaveURL(/\/$/)
  })

  test("a row opened right after typing carries no list params", async ({ page, seed }) => {
    const client = await seedQuotations(seed)
    await page.goto("/quotations")
    await page.getByPlaceholder(SEARCH).fill(seed.prefix)
    await expect(rows(page, client.name)).toHaveCount(10)

    // The search write is still waiting when the row opens.
    await page.getByPlaceholder(SEARCH).fill(`${seed.prefix} `)
    await rows(page, client.name)
      .first()
      .getByRole("button", { name: /^Lihat / })
      .click()
    await expect(page).toHaveURL(/\/quotations\/\d+$/)
    await page.waitForTimeout(500)
    await expect(page).toHaveURL(/\/quotations\/\d+$/)
  })

  test("the menu opens a list in its default state", async ({ page, seed }) => {
    const client = await seedQuotations(seed)
    await narrowList(page, seed, client.name)

    await page.getByRole("navigation").getByRole("link", { name: "Quotation", exact: true }).click()
    await expect(page).toHaveURL(/\/quotations$/)
    await expect(page.getByPlaceholder(SEARCH)).toHaveValue("")
    await expect(page.getByRole("button", { name: /^Hapus filter/ })).toHaveCount(0)
    await expect(page.getByRole("button", { name: "1", exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    )
  })

  test("a malformed URL reads as the default list, without an error page", async ({ page }) => {
    await page.goto(
      "/quotations?page=abc&per=7&status=hilang&preset=besok&from=kemarin&min=x&sort=klien&q=%7B%7D",
    )
    await expect(page.getByRole("heading", { name: "Daftar Quotation" })).toBeVisible()
    await expect(page.getByPlaceholder(SEARCH)).toHaveValue("")
    await expect(page.getByRole("button", { name: /^Hapus filter/ })).toHaveCount(0)
    await expect(page.getByRole("button", { name: "1", exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    )
    await expect(page.getByText(/Terjadi kesalahan/)).toHaveCount(0)
  })

  test("a period search and its chip come back from the URL", async ({ page }) => {
    await page.goto("/purchase-orders?q=10%2F2026&status=PENDING")
    await expect(page.getByPlaceholder("Cari purchase order, klien, atau nomor...")).toHaveValue(
      "10/2026",
    )
    await expect(page.getByRole("button", { name: 'Hapus filter Cari: "10/2026"' })).toBeVisible()
    await expect(page.getByRole("button", { name: "Hapus filter Status: Pending" })).toBeVisible()

    await page.getByRole("button", { name: "Hapus filter Status: Pending" }).click()
    await expect(page).toHaveURL(/\/purchase-orders\?q=10%2F2026$/)
  })
})
