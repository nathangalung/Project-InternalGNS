import type { Page } from "@playwright/test"
import { expect, test } from "./support/seed"

// Quotation Terakhir on detail pages.
//
// A quotation sent to a client shows on its product, vendor and client
// pages, linked to every record it names; a draft never does.

function section(page: Page) {
  return page.getByRole("region", { name: "Quotation Terakhir" })
}

test("a sent quotation shows on its product, vendor and client pages", async ({ page, seed }) => {
  const client = await seed.client()
  const vendor = await seed.vendor()
  const item = await seed.item({ vendor, cost: 100_000 })
  const draft = await seed.quotation({ client, lines: [{ item, qty: 1, price: 120_000 }] })
  const created = await seed.quotation({ client, lines: [{ item, qty: 3, price: 150_000 }] })
  await seed.send(created.id)
  const sent = await seed.getQuotation(created.id)

  // Product: who bought it, through which vendor, at what price.
  await page.goto(`/products/${item.id}`)
  const product = section(page)
  const productRow = product.getByRole("row", { name: new RegExp(sent.quotationNo) })
  await expect(productRow).toContainText(client.name)
  await expect(productRow).toContainText(vendor.name)
  await expect(productRow).toContainText("100.000")
  await expect(productRow).toContainText("150.000")
  await expect(productRow).toContainText("Dikirim")
  if (sent.contactName) await expect(productRow).toContainText(sent.contactName)
  await expect(product.getByRole("row")).toHaveCount(2)
  if (draft.quotationNo) await expect(product).not.toContainText(draft.quotationNo)

  // Vendor: which product went to which client.
  await productRow.getByRole("link", { name: vendor.name }).click()
  await expect(page).toHaveURL(new RegExp(`/vendors/${vendor.id}$`))
  const vendorRow = section(page).getByRole("row", { name: new RegExp(sent.quotationNo) })
  await expect(vendorRow).toContainText(client.name)
  await expect(vendorRow).toContainText(`IMPA ${item.impaCode}`)

  // Client: the quotation itself, with its total and product count.
  await vendorRow.getByRole("link", { name: client.name }).click()
  await expect(page).toHaveURL(new RegExp(`/clients/${client.id}$`))
  const clientRow = section(page).getByRole("row", { name: new RegExp(sent.quotationNo) })
  await expect(clientRow).toContainText("1 produk")
  await expect(clientRow).toContainText("Dikirim")

  // Every quotation number opens the quotation.
  await clientRow.getByRole("link", { name: sent.quotationNo }).click()
  await expect(page).toHaveURL(new RegExp(`/quotations/${sent.id}$`))
})

// The cached list follows a status change.
test("accepting a quotation updates the product's list in place", async ({ page, seed }) => {
  const client = await seed.client()
  const vendor = await seed.vendor()
  const item = await seed.item({ vendor, cost: 100_000 })
  const created = await seed.quotation({
    client,
    lines: [{ item, qty: 1, price: 150_000, cost: 100_000 }],
  })
  await seed.send(created.id)
  const sent = await seed.getQuotation(created.id)

  await page.goto(`/products/${item.id}`)
  const row = section(page).getByRole("row", { name: new RegExp(sent.quotationNo) })
  await expect(row).toContainText("Dikirim")

  await row.getByRole("link", { name: sent.quotationNo }).click()
  await page.getByRole("button", { name: "Status Dikirim, ubah status" }).click()
  await page.getByRole("menu").getByRole("menuitem", { name: "Disetujui" }).click()
  await page
    .getByRole("dialog", { name: "Ubah Status ke Disetujui" })
    .getByRole("button", { name: "Setujui" })
    .click()
  await expect(page.getByRole("button", { name: "Status Disetujui", exact: true })).toBeVisible()

  // Back in the app, not a reload.
  await page.goBack()
  await expect(page).toHaveURL(new RegExp(`/products/${item.id}$`))
  await expect(row).toContainText("Disetujui")
})

test("a product never quoted says so", async ({ page, seed }) => {
  const item = await seed.item()
  await page.goto(`/products/${item.id}`)
  await expect(section(page)).toContainText("Belum ada quotation untuk produk ini.")
})

test.describe("as finance", () => {
  test.use({ session: "finance" })

  // Finance cannot open quotations, so the number reads as plain text.
  test("finance sees a client's quotations without quotation links", async ({ page, seed }) => {
    const client = await seed.client()
    const item = await seed.item()
    const created = await seed.quotation({ client, lines: [{ item, qty: 1, price: 50_000 }] })
    await seed.send(created.id)
    const sent = await seed.getQuotation(created.id)

    await page.goto(`/clients/${client.id}`)
    const row = section(page).getByRole("row", { name: new RegExp(sent.quotationNo) })
    await expect(row).toBeVisible()
    await expect(row.getByRole("link", { name: sent.quotationNo })).toHaveCount(0)
  })
})
