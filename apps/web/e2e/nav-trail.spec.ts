import type { Page } from "@playwright/test"
import type { SalesSeed } from "./support/sales"
import { expect, test } from "./support/seed"

// Navigation trail.
//
// A link into a detail page carries where the reader came from, the page
// shows it as a breadcrumb, and Kembali goes back along it. A page opened
// without a trail falls back to its list.

function crumbs(page: Page) {
  return page.getByRole("navigation", { name: "Breadcrumb" })
}

// The crumbs before the current page.
async function expectTrail(page: Page, labels: string[], current: string) {
  await expect(crumbs(page).getByRole("link")).toHaveText(labels)
  await expect(crumbs(page).locator('[aria-current="page"]')).toHaveText(current)
}

// Quotation with one offered line.
async function quoted(seed: SalesSeed, label?: string) {
  const client = await seed.client()
  const vendor = await seed.vendor()
  const item = await seed.item({ vendor, cost: 60_000, label })
  const q = await seed.quotation({
    client,
    lines: [{ item, qty: 2, price: 100_000, cost: 60_000 }],
  })
  return { vendor, item, q }
}

// The product line's links on the quotation.
function productTable(page: Page) {
  return page.getByRole("heading", { name: "Detail Produk" }).locator("xpath=..")
}

test("quotation to product and Kembali returns to the quotation", async ({ page, seed }) => {
  const { item, q } = await quoted(seed)

  await page.goto(`/quotations/${q.id}`)
  await productTable(page).getByRole("link", { name: item.name, exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/products/${item.id}$`))
  await expectTrail(page, ["Daftar Quotation", `Quotation ${q.quotationNo}`], `Produk ${item.name}`)

  // A reload keeps the trail, which lives on the history entry.
  await page.reload()
  await expectTrail(page, ["Daftar Quotation", `Quotation ${q.quotationNo}`], `Produk ${item.name}`)

  await page.getByRole("button", { name: `Kembali ke Quotation ${q.quotationNo}` }).click()
  await expect(page).toHaveURL(new RegExp(`/quotations/${q.id}$`))
  await expectTrail(page, ["Daftar Quotation"], `Quotation ${q.quotationNo}`)
})

test("quotation to product to vendor goes back one page at a time", async ({ page, seed }) => {
  const { vendor, item, q } = await quoted(seed)

  await page.goto(`/quotations/${q.id}`)
  await productTable(page).getByRole("link", { name: item.name, exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/products/${item.id}$`))
  const vendors = page
    .getByRole("heading", { name: "Daftar Vendor Terkait" })
    .locator("xpath=../../..")
  await vendors.getByRole("link", { name: vendor.name, exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/vendors/${vendor.id}$`))
  await expectTrail(
    page,
    ["Daftar Quotation", `Quotation ${q.quotationNo}`, `Produk ${item.name}`],
    `Vendor ${vendor.name}`,
  )

  await page.getByRole("button", { name: `Kembali ke Produk ${item.name}` }).click()
  await expect(page).toHaveURL(new RegExp(`/products/${item.id}$`))
  await page.getByRole("button", { name: `Kembali ke Quotation ${q.quotationNo}` }).click()
  await expect(page).toHaveURL(new RegExp(`/quotations/${q.id}$`))

  // Back and forth by links adds no crumb twice.
  await productTable(page).getByRole("link", { name: item.name, exact: true }).click()
  await crumbs(page)
    .getByRole("link", { name: `Quotation ${q.quotationNo}` })
    .click()
  await expect(page).toHaveURL(new RegExp(`/quotations/${q.id}$`))
  await expectTrail(page, ["Daftar Quotation"], `Quotation ${q.quotationNo}`)
})

test("a page opened directly falls back to its list", async ({ page, seed }) => {
  const { vendor, item } = await quoted(seed)

  await page.goto(`/products/${item.id}`)
  await expectTrail(page, ["Katalog Produk"], `Produk ${item.name}`)
  await page.getByRole("button", { name: "Kembali ke Katalog Produk" }).click()
  await expect(page).toHaveURL(/\/products$/)
  await expect(page.getByRole("heading", { name: "Katalog Produk" })).toBeVisible()

  await page.goto(`/vendors/${vendor.id}`)
  await crumbs(page).getByRole("link", { name: "Daftar Vendor" }).click()
  await expect(page).toHaveURL(/\/vendors$/)
})

test("saving an editor reached from another page returns along the trail", async ({
  page,
  seed,
}) => {
  const { vendor, item, q } = await quoted(seed)

  await page.goto(`/quotations/${q.id}`)
  await productTable(page).getByRole("link", { name: item.name, exact: true }).click()
  await page.getByRole("button", { name: `Ubah vendor ${vendor.name}` }).click()
  const dialog = page.getByRole("dialog", { name: "Ubah Vendor Terkait" })
  await dialog.getByLabel("Link Produk").fill("https://www.example.com/tali-jejak")
  await dialog.getByRole("button", { name: "Simpan" }).click()
  await expect(dialog).toBeHidden()
  await expect(page).toHaveURL(new RegExp(`/products/${item.id}$`))
  await expectTrail(page, ["Daftar Quotation", `Quotation ${q.quotationNo}`], `Produk ${item.name}`)
  await page.getByRole("button", { name: `Kembali ke Quotation ${q.quotationNo}` }).click()
  await expect(page).toHaveURL(new RegExp(`/quotations/${q.id}$`))

  // The quotation editor saves back to the detail it was opened from.
  await page.getByRole("button", { name: "Ubah", exact: true }).click()
  await expectTrail(
    page,
    ["Daftar Quotation", `Quotation ${q.quotationNo}`],
    `Ubah Quotation ${q.quotationNo}`,
  )
  for (let step = 0; step < 3; step++) {
    await page.getByRole("button", { name: "Lanjut" }).click()
  }
  await page.getByRole("button", { name: "Simpan" }).click()
  await expect(page).toHaveURL(new RegExp(`/quotations/${q.id}$`))
  await expectTrail(page, ["Daftar Quotation"], `Quotation ${q.quotationNo}`)
})

test.describe("on a phone", () => {
  test.use({ viewport: { width: 320, height: 640 } })

  test("a long trail wraps and truncates without scrolling sideways", async ({ page, seed }) => {
    const long = "Tali Tambat Polypropylene Dua Belas Strand Diameter Empat Puluh Milimeter"
    const { item, q } = await quoted(seed, long)

    await page.goto(`/quotations/${q.id}`)
    await productTable(page).getByRole("link", { name: item.name, exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/products/${item.id}$`))
    const current = crumbs(page).locator('[aria-current="page"]')
    await expect(current).toHaveText(`Produk ${item.name}`)
    // The long name is cut with an ellipsis, its full text kept as the title.
    expect(await current.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)
    await expect(current).toHaveAttribute("title", `Produk ${item.name}`)
    const main = page.locator("main")
    const overflow = await main.evaluate((el) => el.scrollWidth - el.clientWidth)
    expect(overflow).toBeLessThanOrEqual(0)
    const box = await crumbs(page).boundingBox()
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(320)
  })
})
