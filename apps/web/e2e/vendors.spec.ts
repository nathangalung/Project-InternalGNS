import { type ApiError, api } from "./support/sales"
import { expect, test } from "./support/seed"

// Vendor master data flows.

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
  await modal.getByLabel("Alamat (Opsional)").fill("Jl. Rungkut Industri No. 5, Surabaya")
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

// Hapus Permanen.
// A vendor entered by mistake goes for good with its links, the product
// stays; a vendor a quotation line uses stays, and the dialog says where.
test("Hapus Permanen deletes an unused vendor and keeps its product", async ({ page, seed }) => {
  const vendor = await seed.vendor()
  const item = await seed.item({ vendor })
  await page.goto(`/vendors/${vendor.id}`)
  await page.getByRole("button", { name: "Hapus Permanen" }).click()
  const dialog = page.getByRole("dialog", { name: "Hapus vendor permanen?" })
  await expect(dialog).toContainText(vendor.name)
  await expect(dialog).toContainText("tidak dapat dibatalkan")
  await dialog.getByRole("button", { name: "Hapus Permanen" }).click()

  await expect(page).toHaveURL(/\/vendors$/)
  await expect(page.getByText("Vendor dihapus permanen.")).toBeVisible()
  const gone = await api("GET", `/vendors/${vendor.id}`).then(
    () => 200,
    (err: ApiError) => err.status,
  )
  expect(gone).toBe(404)
  const offers = await api<{ vendorId: number }[]>("GET", `/items/${item.id}/vendors`)
  expect(offers.map((o) => o.vendorId)).not.toContain(vendor.id)
})

test("Hapus Permanen keeps a quoted vendor and says why", async ({ page, seed }) => {
  const vendor = await seed.vendor()
  const item = await seed.item({ vendor })
  await seed.quotation({ client: await seed.client(), lines: [{ item, qty: 1, price: 150_000 }] })
  await page.goto(`/vendors/${vendor.id}`)
  await page.getByRole("button", { name: "Hapus Permanen" }).click()
  const dialog = page.getByRole("dialog", { name: "Hapus vendor permanen?" })
  await dialog.getByRole("button", { name: "Hapus Permanen" }).click()

  await expect(dialog.getByRole("alert")).toHaveText(
    "Vendor ini sudah dipakai di 1 quotation. Nonaktifkan saja.",
  )
  await expect(page).toHaveURL(new RegExp(`/vendors/${vendor.id}$`))
  await dialog.getByRole("button", { name: "Batal" }).click()
  await expect(dialog).toBeHidden()
  await api("GET", `/vendors/${vendor.id}`)
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
    await expect(page.getByRole("button", { name: "Hapus Permanen" })).toHaveCount(0)
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

// Phone takes 9-12 digits.
const PHONE_ERROR = "Nomor telepon harus 9 sampai 12 digit angka."

test("Tambah Vendor refuses a 13-digit phone inline", async ({ page, seed }) => {
  await page.goto("/vendors")
  await page.getByRole("button", { name: "Tambah Vendor" }).click()
  const modal = page.getByRole("dialog", { name: "Tambah Vendor Baru" })
  const save = modal.getByRole("button", { name: "Simpan Vendor" })
  await modal.getByLabel("Nama Vendor *").fill(seed.name("Vendor Telepon"))
  await modal.getByLabel("Nomor Telepon (Opsional)").fill("8123456789012")
  await expect(modal.getByText(PHONE_ERROR)).toBeVisible()
  await expect(save).toBeDisabled()
  // A valid email does not let the bad phone through.
  await modal.getByLabel("Email (Opsional)").fill(`${seed.prefix.toLowerCase()}@vendor.example`)
  await expect(save).toBeDisabled()
  await modal.getByLabel("Nomor Telepon (Opsional)").fill("812345678901")
  await expect(modal.getByText(PHONE_ERROR)).toBeHidden()
  await expect(save).toBeEnabled()
  await modal.getByRole("button", { name: "Batal" }).click()
  await expect(modal).toBeHidden()
})

test("vendor detail refuses a 13-digit phone and a bad email", async ({ page, seed }) => {
  const vendor = await seed.vendor()
  await page.goto(`/vendors/${vendor.id}`)
  await page.getByLabel("No HP").fill("8123456789012")
  await expect(page.getByText(PHONE_ERROR)).toBeVisible()
  await expect(page.getByLabel("No HP")).toHaveAttribute("aria-invalid", "true")
  await page.getByLabel("Email").fill("toko@maju")
  await expect(page.getByText("Format email tidak valid.")).toBeVisible()
  await page.getByRole("button", { name: "Simpan Perubahan" }).click()

  // Nothing reached the API.
  const v = await api<Vendor>("GET", `/vendors/${vendor.id}`)
  expect([v.contactInfo?.email, v.contactInfo?.phone]).toEqual([
    "vendor@example.com",
    "81298765432",
  ])
})
