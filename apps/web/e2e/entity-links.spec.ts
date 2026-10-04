import type { Page } from "@playwright/test"
import type { SalesSeed } from "./support/sales"
import { expect, test } from "./support/seed"

// Document links between pages.
//
// Every client name opens the client, an accepted quotation opens its PO,
// and an edit page names its document and links back to its detail.

// The client summary card.
function clientCard(page: Page) {
  return page.getByRole("heading", { name: "Ringkasan Klien" }).locator("xpath=..")
}

// Client with one offered line.
async function offered(seed: SalesSeed) {
  const client = await seed.client()
  const vendor = await seed.vendor()
  const item = await seed.item({ vendor, cost: 6_000 })
  return { client, lines: [{ item, qty: 1, price: 10_000, cost: 6_000 }] }
}

test("the quotation list links the client", async ({ page, seed }) => {
  const { client, lines } = await offered(seed)
  const q = await seed.quotation({ client, lines })

  await page.goto("/quotations")
  await page.getByPlaceholder("Cari penawaran, klien, atau nomor...").fill(q.quotationNo)
  const row = page.getByRole("row", { name: new RegExp(q.quotationNo) })
  await expect(row.getByRole("link", { name: client.name })).toHaveAttribute(
    "href",
    `/clients/${client.id}`,
  )
})

test("an accepted quotation links its purchase order", async ({ page, seed }) => {
  const { client, lines } = await offered(seed)
  const q = await seed.quotation({ client, lines })
  const po = await seed.accept(q.id)

  await page.goto(`/quotations/${q.id}`)
  await page.getByRole("link", { name: "Lihat PO" }).click()
  await expect(page).toHaveURL(new RegExp(`/purchase-orders/${q.id}$`))
  await expect(page.getByRole("heading", { name: `Purchase Order ${po.poNumber}` })).toBeVisible()
})

test("the invoice client card links the client", async ({ page, seed }) => {
  const { client, lines } = await offered(seed)
  const q = await seed.quotation({ client, lines })
  await seed.deliver(await seed.accept(q.id))

  await page.goto(`/invoices/${q.id}`)
  await expect(clientCard(page).getByRole("link", { name: client.name })).toHaveAttribute(
    "href",
    `/clients/${client.id}`,
  )
})

test("detail breadcrumbs mark the current page", async ({ page, seed }) => {
  const { client, lines } = await offered(seed)
  const q = await seed.quotation({ client, lines })
  const inv = await seed.deliver(await seed.accept(q.id))
  const pages = [
    { url: `/quotations/${q.id}`, current: `Detail ${q.quotationNo}` },
    { url: `/invoices/${q.id}`, current: `Detail ${inv.invoiceNo}` },
    { url: `/products/${lines[0].item.id}`, current: "Detail Produk" },
  ]

  for (const { url, current } of pages) {
    await page.goto(url)
    const crumbs = page.getByRole("navigation", { name: "Breadcrumb" })
    await expect(crumbs.locator('[aria-current="page"]')).toHaveText(current)
    await expect(crumbs.locator('[aria-hidden="true"]')).toHaveCount(1)
  }
})

test("edit pages name the document and link back to it", async ({ page, seed }) => {
  const { client, lines } = await offered(seed)
  const draft = await seed.quotation({ client, lines })

  await page.goto(`/quotations/${draft.id}/edit`)
  await expect(
    page.getByRole("heading", { name: `Edit Quotation ${draft.quotationNo}` }),
  ).toBeVisible()
  await page.getByRole("link", { name: `Detail ${draft.quotationNo}` }).click()
  await expect(page).toHaveURL(new RegExp(`/quotations/${draft.id}$`))

  const q = await seed.quotation({ client, lines })
  const po = await seed.accept(q.id)
  await page.goto(`/purchase-orders/${q.id}/edit`)
  await expect(
    page.getByRole("heading", { name: `Edit Purchase Order ${po.poNumber}` }),
  ).toBeVisible()
  await page.getByRole("link", { name: `Detail ${po.poNumber}` }).click()
  await expect(page).toHaveURL(new RegExp(`/purchase-orders/${q.id}$`))
})
