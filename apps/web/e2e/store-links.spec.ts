import type { Page } from "@playwright/test"
import { expect, test } from "./support/seed"

// Store links and the client picker.
//
// A vendor's store link is set on the product page and shows wherever the
// item is bought from: the product, the vendor, the quotation and the PO.
// Only an http or https link is kept, so the anchor never runs script.

const link = "https://www.example.com/tali-tambat"

async function expectStoreLink(page: Page): Promise<void> {
  const anchor = page.getByRole("link", { name: "Buka toko example.com di tab baru" }).first()
  await expect(anchor).toBeVisible()
  await expect(anchor).toHaveAttribute("href", link)
  await expect(anchor).toHaveAttribute("target", "_blank")
  await expect(anchor).toHaveAttribute("rel", "noopener noreferrer")
}

test("a store link set on the product shows on every buying page", async ({ page, seed }) => {
  const client = await seed.client()
  const vendor = await seed.vendor()
  const item = await seed.item({ vendor, cost: 60_000 })
  const q = await seed.quotation({
    client,
    lines: [{ item, qty: 2, price: 100_000, cost: 60_000 }],
  })
  await seed.accept(q.id)

  await page.goto(`/products/${item.id}`)
  await page.getByRole("button", { name: `Ubah vendor ${vendor.name}` }).click()
  const dialog = page.getByRole("dialog", { name: "Ubah Vendor Terkait" })
  await expect(dialog.getByLabel("Nama Vendor")).toHaveValue(vendor.name)
  await expect(dialog.getByLabel("Harga Beli")).toHaveValue("60.000")

  await dialog.getByLabel("Link Toko").fill("javascript:alert(1)")
  await expect(dialog.getByText("Link toko harus diawali http:// atau https://.")).toBeVisible()
  await expect(dialog.getByRole("button", { name: "Simpan" })).toBeDisabled()

  await dialog.getByLabel("Link Toko").fill(link)
  await dialog.getByRole("button", { name: "Simpan" }).click()
  await expect(dialog).toBeHidden()
  await expectStoreLink(page)

  await page.goto(`/vendors/${vendor.id}`)
  await expectStoreLink(page)

  await page.goto(`/quotations/${q.id}`)
  await expectStoreLink(page)

  await page.goto(`/purchase-orders/${q.id}`)
  await expectStoreLink(page)
})

test("the client picker pages every client and keeps the search", async ({ page, seed }) => {
  for (let i = 0; i < 11; i++) await seed.client({ complete: false, label: "Halaman" })

  await page.goto("/quotations/add")
  const pager = page.getByText(/^Menampilkan \d+-\d+ dari \d+ klien$/)
  await expect(pager).toHaveText(/^Menampilkan 1-10 dari \d+ klien$/)

  await page.getByRole("button", { name: "Halaman berikutnya" }).click()
  await expect(pager).toHaveText(/^Menampilkan 11-\d+ dari \d+ klien$/)

  await page.getByLabel("Cari klien").fill(`${seed.prefix} Halaman`)
  await expect(pager).toHaveText(/^Menampilkan 1-10 dari \d+ klien$/)
  await page.getByRole("button", { name: "Halaman berikutnya" }).click()
  await expect(pager).toHaveText(/^Menampilkan 11-\d+ dari \d+ klien$/)
})
