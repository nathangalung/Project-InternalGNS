import type { Page } from "@playwright/test"
import { api, type SalesSeed } from "./support/sales"
import { expect, test } from "./support/seed"

// Product and store links, client picker.
//
// Link Produk is where a vendor sells one product. It is set on the product
// page, the quotation product dialog or a PO line, and shows wherever the
// item is bought from: the product, the vendor, the quotation and the PO.
// Link Toko is the vendor's own shop, set on the vendor and shown beside its
// name. Only an http or https link is kept, so the anchor never runs script.

const link = "https://www.example.com/tali-tambat"
const store = "https://www.example.com/toko-maju"

async function expectStoreLink(page: Page): Promise<void> {
  const anchor = page.getByRole("link", { name: "Buka toko example.com di tab baru" }).first()
  await expect(anchor).toBeVisible()
  await expect(anchor).toHaveAttribute("href", store)
  await expect(anchor).toHaveAttribute("target", "_blank")
}

async function expectProductLink(page: Page): Promise<void> {
  const anchor = page.getByRole("link", { name: "Buka produk di example.com di tab baru" }).first()
  await expect(anchor).toBeVisible()
  await expect(anchor).toHaveAttribute("href", link)
  await expect(anchor).toHaveAttribute("target", "_blank")
  await expect(anchor).toHaveAttribute("rel", "noopener noreferrer")
}

test("a product link set on the product shows on every buying page", async ({ page, seed }) => {
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

  await dialog.getByLabel("Link Produk").fill("javascript:alert(1)")
  await expect(dialog.getByText("Link produk harus diawali http:// atau https://.")).toBeVisible()
  await expect(dialog.getByRole("button", { name: "Simpan" })).toBeDisabled()

  await dialog.getByLabel("Link Produk").fill(link)
  await dialog.getByRole("button", { name: "Simpan" }).click()
  await expect(dialog).toBeHidden()
  await expectProductLink(page)

  await page.goto(`/vendors/${vendor.id}`)
  await expectProductLink(page)

  await page.goto(`/quotations/${q.id}`)
  await expectProductLink(page)

  await page.goto(`/purchase-orders/${q.id}`)
  await expectProductLink(page)
})

test("a vendor's Link Toko is set on its page and shows beside the vendor", async ({
  page,
  seed,
}) => {
  const { vendor, item, q } = await acceptedPo(seed)
  await api("POST", `/items/${item.id}/vendors`, { vendorId: vendor.id, productUrl: link })

  await page.goto(`/vendors/${vendor.id}`)
  await page.getByLabel("Link Toko").fill("javascript:alert(1)")
  await expect(page.getByText("Link toko harus diawali http:// atau https://.")).toBeVisible()
  await page.getByRole("button", { name: "Simpan Perubahan" }).click()
  await expect
    .poll(async () => (await api<{ storeUrl?: string }>("GET", `/vendors/${vendor.id}`)).storeUrl)
    .toBeUndefined()

  await page.getByLabel("Link Toko").fill(store)
  await page.getByRole("button", { name: "Simpan Perubahan" }).click()
  await expect
    .poll(async () => (await api<{ storeUrl?: string }>("GET", `/vendors/${vendor.id}`)).storeUrl)
    .toBe(store)
  await page.reload()
  await expect(page.getByLabel("Link Toko")).toHaveValue(store)
  await expectStoreLink(page)

  await page.goto("/vendors")
  await page.getByPlaceholder("Cari nama, negara asal vendor...").fill(vendor.name)
  const row = page.getByRole("row", { name: new RegExp(vendor.name) })
  await expect(row.getByRole("link", { name: "Buka toko example.com di tab baru" })).toBeVisible()

  await page.goto(`/products/${item.id}`)
  await expectStoreLink(page)
  await expectProductLink(page)

  // Each line names the vendor's shop and the product page apart.
  for (const path of [`/quotations/${q.id}`, `/purchase-orders/${q.id}`]) {
    await page.goto(path)
    await expectStoreLink(page)
    await expectProductLink(page)
  }
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

test.describe("product link from the PO", () => {
  test("Tambah Link Produk on a PO line sets the link at once and keeps harga beli", async ({
    page,
    seed,
  }) => {
    const { vendor, item, q } = await acceptedPo(seed)

    await page.goto(`/purchase-orders/${q.id}`)
    await page.getByRole("button", { name: "Tambah Link Produk" }).click()
    const dialog = page.getByRole("dialog", { name: "Tambah Link Produk" })
    await expect(dialog).toContainText(vendor.name)
    await expect(dialog.getByRole("button", { name: "Simpan" })).toBeDisabled()

    await dialog.getByLabel("Link Produk").fill("javascript:alert(1)")
    await expect(dialog.getByText("Link produk harus diawali http:// atau https://.")).toBeVisible()
    await expect(dialog.getByRole("button", { name: "Simpan" })).toBeDisabled()

    await dialog.getByLabel("Link Produk").fill(link)
    await dialog.getByRole("button", { name: "Simpan" }).click()
    await expect(dialog).toBeHidden()
    await expectProductLink(page)
    await expect(page.getByRole("button", { name: "Ubah Link Produk" })).toBeVisible()

    const stored = await storedLink(item.id, vendor.id)
    expect([stored?.productUrl, stored?.costPrice]).toEqual([link, "60000.00"])

    // The quotation reads the same link.
    await page.goto(`/quotations/${q.id}`)
    await expectProductLink(page)
  })

  test("Ubah Link Produk changes the link and an emptied one is removed", async ({
    page,
    seed,
  }) => {
    const { vendor, item, q } = await acceptedPo(seed)
    await api("POST", `/items/${item.id}/vendors`, { vendorId: vendor.id, productUrl: link })
    const moved = "https://www.example.com/tali-baru"

    await page.goto(`/purchase-orders/${q.id}`)
    await expectProductLink(page)
    await page.getByRole("button", { name: "Ubah Link Produk" }).click()
    const dialog = page.getByRole("dialog", { name: "Ubah Link Produk" })
    await expect(dialog.getByLabel("Link Produk")).toHaveValue(link)
    await dialog.getByLabel("Link Produk").fill(moved)
    await dialog.getByRole("button", { name: "Simpan" }).click()
    await expect(dialog).toBeHidden()
    await expect(
      page.getByRole("link", { name: "Buka produk di example.com di tab baru" }),
    ).toHaveAttribute("href", moved)

    await page.getByRole("button", { name: "Ubah Link Produk" }).click()
    await dialog.getByLabel("Link Produk").fill("")
    await dialog.getByRole("button", { name: "Simpan" }).click()
    await expect(dialog).toBeHidden()
    await expect(page.getByRole("link", { name: /^Buka produk di / })).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Tambah Link Produk" })).toBeVisible()
    const stored = await storedLink(item.id, vendor.id)
    expect([stored?.productUrl, stored?.costPrice]).toEqual([undefined, "60000.00"])
  })

  test("Tambah Link Produk on the quotation sets the link and keeps harga beli", async ({
    page,
    seed,
  }) => {
    const { vendor, item, q } = await acceptedPo(seed)

    await page.goto(`/quotations/${q.id}`)
    await page.getByRole("button", { name: "Tambah Link Produk" }).click()
    const dialog = page.getByRole("dialog", { name: "Tambah Link Produk" })
    await dialog.getByLabel("Link Produk").fill(link)
    await dialog.getByRole("button", { name: "Simpan" }).click()
    await expect(dialog).toBeHidden()
    await expectProductLink(page)

    const stored = await storedLink(item.id, vendor.id)
    expect([stored?.productUrl, stored?.costPrice]).toEqual([link, "60000.00"])
  })

  test.describe("as the finance head", () => {
    test.use({ session: "finance" })

    test("the link shows on the PO and quotation but cannot be changed", async ({ page, seed }) => {
      const { vendor, item, q } = await acceptedPo(seed)
      await api("POST", `/items/${item.id}/vendors`, { vendorId: vendor.id, productUrl: link })

      for (const path of [`/purchase-orders/${q.id}`, `/quotations/${q.id}`]) {
        await page.goto(path)
        await expectProductLink(page)
        await expect(page.getByRole("button", { name: /Link Produk$/ })).toHaveCount(0)
      }
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
