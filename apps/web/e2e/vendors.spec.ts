import { api } from "./support/sales"
import { expect, test } from "./support/seed"

// Vendor master data through the UI.

type Vendor = {
  name: string
  location?: string
  isActive: boolean
  contactInfo?: { email?: string; phone?: string }
}

test("Tambah Vendor creates an active vendor the list finds", async ({ page, seed }) => {
  const name = seed.name("Vendor Baru")
  await page.goto("/vendors")
  await page.getByRole("button", { name: "Tambah Vendor" }).click()
  const modal = page.getByRole("dialog", { name: "Tambah Vendor Baru" })
  const save = modal.getByRole("button", { name: "Simpan Vendor" })
  await modal.getByLabel("Nama Vendor *").fill(name)
  await modal.getByLabel("Alamat *").fill("Jl. Rungkut Industri No. 5, Surabaya")
  await expect(save).toBeDisabled()
  await modal.getByLabel("Email (Opsional)").fill(`${seed.prefix.toLowerCase()}@vendor.example`)
  await save.click()
  await expect(modal).toBeHidden()
  const id = await seed.adopt("vendor", name)

  await page.getByPlaceholder("Cari nama, negara asal vendor...").fill(seed.prefix)
  const row = page.getByRole("row", { name: new RegExp(name) })
  await expect(row).toContainText("AKTIF")
  const link = row.getByRole("link", { name, exact: true })
  await expect(link).toHaveAttribute("href", `/vendors/${id}`)
  await link.click()
  await expect(page.getByRole("heading", { name, level: 2 })).toBeVisible()
  await expect(page.getByLabel("Email")).toHaveValue(`${seed.prefix.toLowerCase()}@vendor.example`)
})

test("a vendor's email and phone can be cleared", async ({ page, seed }) => {
  const vendor = await seed.vendor()
  await page.goto(`/vendors/${vendor.id}`)
  await expect(page.getByLabel("Email")).toHaveValue("vendor@example.com")
  await page.getByLabel("Email").fill("")
  await page.getByLabel("No HP").fill("")
  await page.getByRole("button", { name: "Simpan Perubahan" }).click()

  // MD-05: emptied fields are dropped, not merged back from the old value.
  await expect
    .poll(async () => {
      const v = await api<Vendor>("GET", `/vendors/${vendor.id}`)
      return [v.contactInfo?.email ?? null, v.contactInfo?.phone ?? null, v.location]
    })
    .toEqual([null, null, "Surabaya"])
  await page.reload()
  await expect(page.getByLabel("Email")).toHaveValue("")
  await expect(page.getByLabel("No HP")).toHaveValue("")
})

test("the vendor's product list links to each product", async ({ page, seed }) => {
  const vendor = await seed.vendor()
  const item = await seed.item({ vendor, cost: 42_500 })
  await page.goto(`/vendors/${vendor.id}`)
  await expect(page.getByRole("heading", { name: "Daftar Produk Vendor (1)" })).toBeVisible()
  const row = page.getByRole("row", { name: new RegExp(item.name) })
  await expect(row).toContainText("Rp42.500")
  const link = row.getByRole("link", { name: item.name })
  await expect(link).toHaveAttribute("href", `/products/${item.id}`)
  await link.click()
  await expect(page.getByRole("heading", { name: item.name, level: 2 })).toBeVisible()
  // And back again from the product's vendor list.
  await page.getByRole("link", { name: vendor.name }).click()
  await expect(page).toHaveURL(new RegExp(`/vendors/${vendor.id}$`))
})

test.describe("as finance", () => {
  test.use({ session: "finance" })

  test("finance reads vendors but cannot change them", async ({ page, seed }) => {
    const vendor = await seed.vendor()
    await page.goto("/vendors")
    await expect(page.getByRole("heading", { name: "Daftar Vendor" })).toBeVisible()
    await expect(page.getByRole("button", { name: "Tambah Vendor" })).toHaveCount(0)
    await page.goto(`/vendors/${vendor.id}`)
    await expect(page.getByText("Informasi vendor, hanya dapat dilihat.")).toBeVisible()
    await expect(page.getByLabel("Nama Vendor")).not.toBeEditable()
    await expect(page.getByRole("switch", { name: "Status Vendor" })).toBeDisabled()
    await expect(page.getByRole("button", { name: "Simpan Perubahan" })).toHaveCount(0)
  })
})

test("a vendor with many products pages its list", async ({ page, seed }) => {
  const vendor = await seed.vendor()
  for (let i = 0; i < 12; i++) await seed.item({ vendor, cost: 1_000 + i })
  await page.goto(`/vendors/${vendor.id}`)
  // MD-12: the heading counts every product, not the first page.
  await expect(page.getByRole("heading", { name: "Daftar Produk Vendor (12)" })).toBeVisible()
  const table = page.getByRole("heading", { name: "Daftar Produk Vendor (12)" }).locator("xpath=..")
  await expect(page.getByText("Menampilkan 1-10 dari 12 Produk")).toBeVisible()
  await expect(table.getByRole("row", { name: new RegExp(seed.prefix) })).toHaveCount(10)
  await page.getByRole("button", { name: "Halaman berikutnya" }).last().click()
  await expect(page.getByText("Menampilkan 11-12 dari 12 Produk")).toBeVisible()
  await expect(table.getByRole("row", { name: new RegExp(seed.prefix) })).toHaveCount(2)
})
