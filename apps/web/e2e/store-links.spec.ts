import type { Page } from "@playwright/test"
import { api, type SalesSeed } from "./support/sales"
import { expect, test } from "./support/seed"

// Store links, client picker.
//
// A vendor's store link is set on the product page, the quotation product
// dialog or a PO line, and shows wherever the item is bought from: the
// product, the vendor, the quotation and the PO. Only an http or https link
// is kept, so the anchor never runs script.

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

// Accepted quotation, linked vendor.
async function acceptedPo(seed: SalesSeed) {
  const client = await seed.client()
  const vendor = await seed.vendor()
  const item = await seed.item({ vendor, cost: 60_000 })
  const q = await seed.quotation({
    client,
    lines: [{ item, qty: 2, price: 100_000, cost: 60_000 }],
  })
  await seed.accept(q.id)
  return { vendor, item, q }
}

// The item's link to the vendor.
async function storedLink(itemId: number, vendorId: number) {
  const rows = await api<{ vendorId: number; productUrl?: string; costPrice?: string }[]>(
    "GET",
    `/items/${itemId}/vendors`,
  )
  return rows.find((r) => r.vendorId === vendorId)
}

test.describe("store link from the PO", () => {
  test("Tambah Link Toko on a PO line sets the link at once and keeps harga beli", async ({
    page,
    seed,
  }) => {
    const { vendor, item, q } = await acceptedPo(seed)

    await page.goto(`/purchase-orders/${q.id}`)
    await page.getByRole("button", { name: "Tambah Link Toko" }).click()
    const dialog = page.getByRole("dialog", { name: "Tambah Link Toko" })
    await expect(dialog).toContainText(vendor.name)
    await expect(dialog.getByRole("button", { name: "Simpan" })).toBeDisabled()

    await dialog.getByLabel("Link Toko").fill("javascript:alert(1)")
    await expect(dialog.getByText("Link toko harus diawali http:// atau https://.")).toBeVisible()
    await expect(dialog.getByRole("button", { name: "Simpan" })).toBeDisabled()

    await dialog.getByLabel("Link Toko").fill(link)
    await dialog.getByRole("button", { name: "Simpan" }).click()
    await expect(dialog).toBeHidden()
    await expectStoreLink(page)
    await expect(page.getByRole("button", { name: "Ubah Link Toko" })).toBeVisible()

    const stored = await storedLink(item.id, vendor.id)
    expect([stored?.productUrl, stored?.costPrice]).toEqual([link, "60000.00"])

    // The quotation reads the same link.
    await page.goto(`/quotations/${q.id}`)
    await expectStoreLink(page)
  })

  test("Ubah Link Toko changes the link and an emptied one is removed", async ({ page, seed }) => {
    const { vendor, item, q } = await acceptedPo(seed)
    await api("POST", `/items/${item.id}/vendors`, { vendorId: vendor.id, productUrl: link })
    const moved = "https://www.example.com/tali-baru"

    await page.goto(`/purchase-orders/${q.id}`)
    await expectStoreLink(page)
    await page.getByRole("button", { name: "Ubah Link Toko" }).click()
    const dialog = page.getByRole("dialog", { name: "Ubah Link Toko" })
    await expect(dialog.getByLabel("Link Toko")).toHaveValue(link)
    await dialog.getByLabel("Link Toko").fill(moved)
    await dialog.getByRole("button", { name: "Simpan" }).click()
    await expect(dialog).toBeHidden()
    await expect(
      page.getByRole("link", { name: "Buka toko example.com di tab baru" }),
    ).toHaveAttribute("href", moved)

    await page.getByRole("button", { name: "Ubah Link Toko" }).click()
    await dialog.getByLabel("Link Toko").fill("")
    await dialog.getByRole("button", { name: "Simpan" }).click()
    await expect(dialog).toBeHidden()
    await expect(page.getByRole("link", { name: /^Buka toko / })).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Tambah Link Toko" })).toBeVisible()
    const stored = await storedLink(item.id, vendor.id)
    expect([stored?.productUrl, stored?.costPrice]).toEqual([undefined, "60000.00"])
  })

  test.describe("as the finance head", () => {
    test.use({ session: "finance" })

    test("the link shows on the PO but cannot be changed", async ({ page, seed }) => {
      const { vendor, item, q } = await acceptedPo(seed)
      await api("POST", `/items/${item.id}/vendors`, { vendorId: vendor.id, productUrl: link })

      await page.goto(`/purchase-orders/${q.id}`)
      await expectStoreLink(page)
      await expect(page.getByRole("button", { name: /Link Toko$/ })).toHaveCount(0)
    })
  })
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
