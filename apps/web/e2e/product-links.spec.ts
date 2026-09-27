import type { Page } from "@playwright/test"
import type { SalesSeed, SeedItem } from "./support/sales"
import { expect, test } from "./support/seed"

// Product links on every document.
//
// Every document's product table links a catalog line to its product page.
// A free-text line names no catalog item, so it stays plain text.

type Seeded = { item: SeedItem; freeText: string; quotationId: number }

// Draft with both line kinds.
async function mixedQuotation(seed: SalesSeed): Promise<Seeded> {
  const client = await seed.client()
  const vendor = await seed.vendor()
  const item = await seed.item({ vendor, cost: 60_000 })
  const freeText = seed.name("Permintaan bebas")
  const q = await seed.quotation({
    client,
    lines: [
      { item, qty: 2, price: 100_000, cost: 60_000 },
      { freeText, qty: 1, price: 50_000 },
    ],
  })
  return { item, freeText, quotationId: q.id }
}

// Link, plain text, then follow.
async function expectProductLinks(page: Page, { item, freeText }: Seeded): Promise<void> {
  const table = page.getByRole("heading", { name: "Detail Produk" }).locator("xpath=..")
  await expect(table.getByRole("cell", { name: freeText })).toBeVisible()
  await expect(table.getByRole("link", { name: freeText })).toHaveCount(0)
  const link = table.getByRole("link", { name: item.name })
  await expect(link).toHaveAttribute("href", `/products/${item.id}`)
  await link.click()
  await expect(page).toHaveURL(new RegExp(`/products/${item.id}$`))
  await expect(page.getByRole("heading", { name: item.name, level: 2 })).toBeVisible()
}

test("quotation detail links its catalog product", async ({ page, seed }) => {
  const seeded = await mixedQuotation(seed)
  await page.goto(`/quotations/${seeded.quotationId}`)
  await expectProductLinks(page, seeded)
})

test("purchase order detail links its catalog product", async ({ page, seed }) => {
  const seeded = await mixedQuotation(seed)
  const po = await seed.accept(seeded.quotationId)
  await page.goto(`/purchase-orders/${seeded.quotationId}`)
  await expect(page.getByRole("heading", { name: `Purchase Order ${po.poNumber}` })).toBeVisible()
  await expectProductLinks(page, seeded)
})

test("invoice detail links its catalog product", async ({ page, seed }) => {
  const seeded = await mixedQuotation(seed)
  const inv = await seed.deliver(await seed.accept(seeded.quotationId))
  await page.goto(`/invoices/${seeded.quotationId}`)
  await expect(page.getByRole("heading", { name: `Invoice ${inv.invoiceNo}` })).toBeVisible()
  await expectProductLinks(page, seeded)
})
