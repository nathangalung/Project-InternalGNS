import { expect, test } from "./support/seed"

// What each input role sees.
//
// Operational input works without harga jual, finance input without harga
// beli, and the finance head reads operational documents without editing
// them. The API leaves the hidden figures out, so the pages show no column
// for them rather than a zero.

test.describe("as operational input", () => {
  test.use({ session: "operational_input" })

  test("a quotation shows no selling figure and no download", async ({ page, seed }) => {
    const client = await seed.client()
    const vendor = await seed.vendor()
    const item = await seed.item({ vendor, cost: 60_000 })
    const q = await seed.quotation({
      client,
      lines: [{ item, qty: 2, price: 100_000, cost: 60_000 }],
    })

    await page.goto(`/quotations/${q.id}`)
    await expect(page.getByRole("heading", { name: "Detail Produk" })).toBeVisible()
    await expect(page.getByRole("cell", { name: item.name }).first()).toBeVisible()
    await expect(page.getByRole("columnheader", { name: "Harga Jual Satuan" })).toHaveCount(0)
    await expect(page.getByText("Grand Total")).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Unduh PDF" })).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Ubah", exact: true })).toBeVisible()

    await page.goto("/quotations")
    await expect(page.getByRole("columnheader", { name: "Total Penawaran" })).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Ekspor Excel" })).toHaveCount(0)
  })

  test("the product dialog asks for harga beli only", async ({ page, seed }) => {
    const client = await seed.client()
    await page.goto("/quotations/add")
    await page.getByLabel("Cari klien").fill(seed.prefix)
    await page.getByRole("button", { name: new RegExp(client.name) }).click()
    await page.getByRole("button", { name: "Lanjut" }).click()
    await expect(page.getByRole("button", { name: "Tambah Diskon" })).toHaveCount(0)
    await page.getByRole("button", { name: "Tambah Produk" }).click()
    const dialog = page.getByRole("dialog", { name: "Tambah Produk ke Quotation" })
    await expect(dialog.getByLabel("Harga Beli Satuan *")).toBeVisible()
    await expect(dialog.getByLabel("Harga Jual Satuan *")).toHaveCount(0)
    await expect(dialog.getByRole("button", { name: "Riwayat Harga Jual" })).toHaveCount(0)
  })
})

test.describe("as finance input", () => {
  test.use({ session: "finance_input" })

  test("a PO shows what is billed but no cost or profit", async ({ page, seed }) => {
    const client = await seed.client()
    const vendor = await seed.vendor()
    const item = await seed.item({ vendor, cost: 60_000 })
    const q = await seed.quotation({
      client,
      lines: [{ item, qty: 2, price: 100_000, cost: 60_000 }],
    })
    await seed.accept(q.id)

    await page.goto(`/purchase-orders/${q.id}`)
    await expect(page.getByRole("columnheader", { name: "Harga Jual Satuan" })).toBeVisible()
    await expect(page.getByRole("columnheader", { name: "Profit (Rp)" })).toHaveCount(0)
    await expect(page.getByText("Total Estimasi Profit")).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Ubah", exact: true })).toHaveCount(0)
  })

  test("a client opens with only NPWP and TKU editable", async ({ page, seed }) => {
    const client = await seed.client({ complete: false })
    await page.goto(`/clients/${client.id}`)
    await expect(page.getByLabel(/^Nama Klien/)).toBeDisabled()
    await expect(page.getByLabel("NPWP", { exact: true })).toBeEnabled()
    await expect(page.getByRole("button", { name: "+ Tambah Narahubung" })).toHaveCount(0)
  })
})

test.describe("as the finance head", () => {
  test.use({ session: "finance" })

  test("a quotation reads in full but is not edited", async ({ page, seed }) => {
    const client = await seed.client()
    const vendor = await seed.vendor()
    const item = await seed.item({ vendor, cost: 60_000 })
    const q = await seed.quotation({
      client,
      lines: [{ item, qty: 2, price: 100_000, cost: 60_000 }],
    })

    await page.goto(`/quotations/${q.id}`)
    await expect(page.getByRole("columnheader", { name: "Harga Jual Satuan" })).toBeVisible()
    await expect(page.getByRole("button", { name: "Unduh PDF" })).toBeVisible()
    await expect(page.getByRole("button", { name: "Ubah", exact: true })).toHaveCount(0)

    await page.goto(`/quotations/${q.id}/edit`)
    await expect(page).toHaveURL(/\/$/)
  })
})
