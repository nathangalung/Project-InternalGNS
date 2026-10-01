import type { Page } from "@playwright/test"
import type { SalesSeed, SeedItem } from "./support/sales"
import { expect, test } from "./support/seed"

// Product links on every document.
//
// Every document's product table links a catalog line to its product page.
// A free-text line names no catalog item, so it stays plain text. Only an
// offered line reaches the PO and the invoice, so a quotation that goes on
// marks its free-text request Tidak Ditawarkan.

type Seeded = { item: SeedItem; freeText: string; quotationId: number }

// Quotation with both line kinds.
async function mixedQuotation(seed: SalesSeed, freeTextOffered = true): Promise<Seeded> {
  const client = await seed.client()
  const vendor = await seed.vendor()
  const item = await seed.item({ vendor, cost: 60_000 })
  const freeText = seed.name("Permintaan bebas")
  const q = await seed.quotation({
    client,
    lines: [
      { item, qty: 2, price: 100_000, cost: 60_000 },
      { freeText, qty: 1, price: 50_000, noOffer: !freeTextOffered },
    ],
  })
  return { item, freeText, quotationId: q.id }
}

// Catalog link, then follow.
// freeTextShown says whether the free-text line is on this document.
async function expectProductLinks(
  page: Page,
  { item, freeText }: Seeded,
  freeTextShown: boolean,
): Promise<void> {
  const table = page.getByRole("heading", { name: "Detail Produk" }).locator("xpath=..")
  if (freeTextShown) {
    await expect(table.getByRole("cell", { name: freeText })).toBeVisible()
  } else {
    await expect(table.getByText(freeText)).toHaveCount(0)
  }
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
  await expectProductLinks(page, seeded, true)
})

test("purchase order detail links its catalog product", async ({ page, seed }) => {
  const seeded = await mixedQuotation(seed, false)
  const po = await seed.accept(seeded.quotationId)
  await page.goto(`/purchase-orders/${seeded.quotationId}`)
  await expect(page.getByRole("heading", { name: `Purchase Order ${po.poNumber}` })).toBeVisible()
  await expectProductLinks(page, seeded, false)
})

test("invoice detail links its catalog product", async ({ page, seed }) => {
  const seeded = await mixedQuotation(seed, false)
  const inv = await seed.deliver(await seed.accept(seeded.quotationId))
  await page.goto(`/invoices/${seeded.quotationId}`)
  await expect(page.getByRole("heading", { name: `Invoice ${inv.invoiceNo}` })).toBeVisible()
  await expectProductLinks(page, seeded, false)
})
