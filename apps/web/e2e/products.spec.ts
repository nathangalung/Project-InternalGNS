import { api, deactivate } from "./support/sales"
import { expect, test } from "./support/seed"

// Katalog Produk flows.
//
// Create, link a vendor, filters and the read-only finance view.

type ItemVendor = { vendorId: number; costPrice?: string }

test("Tambah Produk adds an item the Katalog search finds", async ({ page, seed }) => {
  const name = seed.name("Produk Baru")
  const impa = String(200000 + Math.floor(Math.random() * 700000))
  await page.goto("/products")
  await page.getByRole("button", { name: "Tambah Produk" }).click()
  const modal = page.getByRole("dialog", { name: "Tambah Produk Baru" })
  const add = modal.getByRole("button", { name: "Tambahkan" })
  await expect(add).toBeDisabled()
  await modal.getByLabel("Nama Produk *").fill(name)
  await modal.getByLabel("Kode IMPA").fill(impa)
  await modal.getByLabel("Satuan Default").fill("PCS")
  await modal.getByRole("button", { name: /^PCS/ }).first().click()
  await add.click()
  await expect(modal).toBeHidden()
  const id = await seed.adopt("item", name)

  await page.getByPlaceholder("Cari kode IMPA, nama, kategori produk...").fill(name)
  const row = page.getByRole("row", { name: new RegExp(name) })
  await expect(row).toContainText(impa)
  await expect(row).toContainText("PCS")
  await expect(row).toContainText("AKTIF")
  await expect(row.getByRole("link", { name, exact: true })).toHaveAttribute(
    "href",
    `/products/${id}`,
  )
})

test("Tambah Vendor searches the server for active vendors and links one", async ({
  page,
  seed,
}) => {
  const item = await seed.item()
  const active = await seed.vendor({ label: "Vendor Aktif" })
  const inactive = await seed.vendor({ label: "Vendor Nonaktif" })
  await deactivate("vendor", inactive.id)

  await page.goto(`/products/${item.id}`)
  await page.getByRole("button", { name: "Tambah Vendor" }).click()
  const modal = page.getByRole("dialog", { name: "Tambah Vendor Terkait" })
  const add = modal.getByRole("button", { name: "Tambahkan" })
  // MD-02: the picker asks the server, so any active vendor is reachable.
  const searched = page.waitForResponse(
    (r) => r.url().includes("/vendors?") && r.url().includes(`q=${seed.prefix}`),
  )
  await modal.getByLabel("Nama Vendor *").fill(seed.prefix)
  const response = await searched
  expect(new URL(response.url()).searchParams.get("isActive")).toBe("true")
  // MD-11: an inactive vendor is never offered.
  await expect(modal.getByRole("button", { name: new RegExp(active.name) })).toBeVisible()
  await expect(modal.getByRole("button", { name: new RegExp(inactive.name) })).toHaveCount(0)
  await modal.getByRole("button", { name: new RegExp(active.name) }).click()
  await expect(add).toBeDisabled()
  await modal.getByLabel("Harga Beli *").fill("125000")
  await add.click()
  await expect(modal).toBeHidden()

  const vendors = page
    .getByRole("heading", { name: "Daftar Vendor Terkait" })
    .locator("xpath=../../..")
  const row = vendors.getByRole("row", { name: new RegExp(active.name) })
  await expect(row).toContainText("Rp125.000")
  await expect(row.getByRole("link", { name: active.name })).toHaveAttribute(
    "href",
    `/vendors/${active.id}`,
  )
  const linked = await api<ItemVendor[]>("GET", `/items/${item.id}/vendors`)
  expect(linked).toEqual([expect.objectContaining({ vendorId: active.id, costPrice: "125000.00" })])
})

test("renaming a product and turning it off saves both", async ({ page, seed }) => {
  const item = await seed.item()
  const renamed = seed.name("Produk Ganti Nama")
  await page.goto(`/products/${item.id}`)
  const save = page.getByRole("button", { name: "Simpan Perubahan" })
  await expect(save).toBeDisabled()
  await page.getByLabel("Nama Produk *").fill(renamed)
  await page.getByRole("switch", { name: "Status Produk" }).click()
  await save.click()
  await expect
    .poll(async () => {
      const it = await api<{ name: string; isActive: boolean }>("GET", `/items/${item.id}`)
      return [it.name, it.isActive]
    })
    .toEqual([renamed, false])
})

test.describe("as finance", () => {
  test.use({ session: "finance" })

  test("finance reads the catalog but cannot change it", async ({ page, seed }) => {
    const vendor = await seed.vendor()
    const item = await seed.item({ vendor })
    await page.goto("/products")
    await expect(page.getByRole("heading", { name: "Katalog Produk" })).toBeVisible()
    await expect(page.getByRole("button", { name: "Tambah Produk" })).toHaveCount(0)
    await page.goto(`/products/${item.id}`)
    await expect(page.getByRole("heading", { name: item.name, level: 2 })).toBeVisible()
    await expect(page.getByLabel(/Nama Produk/)).not.toBeEditable()
    await expect(page.getByRole("button", { name: "Tambah Vendor" })).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Simpan Perubahan" })).toHaveCount(0)
    await expect(page.getByRole("link", { name: vendor.name })).toHaveAttribute(
      "href",
      `/vendors/${vendor.id}`,
    )
  })
})

// Open bug: inactive search gap.
//
// The Katalog search never finds a deactivated product, not even under
// Nonaktif. search-advanced reads its name layer from fn_search_items,
// which is active-only, while ProductDetail promises the product stays in
// the Katalog. test.fail keeps the repro running; drop it once fixed.
test("a deactivated product is found by name under the Nonaktif filter", async ({ page, seed }) => {
  test.fail(true, "search-advanced drops inactive items from its name layer")
  const kept = await seed.item({ label: "Produk Aktif" })
  const dropped = await seed.item({ label: "Produk Nonaktif" })
  await deactivate("item", dropped.id)

  await page.goto("/products")
  await page.getByRole("button", { name: "Filter" }).click()
  const filter = page.getByRole("dialog", { name: "Filter Produk" })
  await filter.getByRole("button", { name: "Nonaktif" }).click()
  await filter.getByRole("button", { name: "Terapkan" }).click()
  await page.getByPlaceholder("Cari kode IMPA, nama, kategori produk...").fill(dropped.name)
  const row = page.getByRole("row", { name: new RegExp(dropped.name) })
  await expect(row).toContainText("NONAKTIF")
  await expect(page.getByRole("link", { name: kept.name, exact: true })).toHaveCount(0)
})
