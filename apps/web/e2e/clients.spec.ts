import type { Page } from "@playwright/test"
import type { PurchaseOrderItemRow } from "../src/types/generated"
import { api, deactivate, idFrom, rupiah } from "./support/sales"
import { expect, test } from "./support/seed"

// Client master data flows.
//
// Create, edit, contacts, logo and deactivation through the UI.

type Contact = { id: number; name: string; email?: string; title?: string; phone?: string }

// Client contact card locator.
function contactsCard(page: Page) {
  return page.getByRole("heading", { name: "Daftar Narahubung" }).locator("xpath=../../..")
}

test("Tambah Klien creates a server-numbered client the list finds", async ({ page, seed }) => {
  const name = seed.name("Klien Baru")
  await page.goto("/clients")
  await page.getByRole("button", { name: "Tambah Klien" }).click()
  const modal = page.getByRole("dialog", { name: "Tambah Klien" })
  const save = modal.getByRole("button", { name: "Simpan Data" })
  await modal.getByLabel("Nama Perusahaan *").fill(name)
  await modal.getByLabel("Alamat (Opsional)").fill("Jl. Raya Pelabuhan No. 8, Surabaya")
  await modal.getByLabel("Nama Narahubung *").fill(`${seed.prefix} Rina`)
  // A contact needs a phone or an email.
  await expect(save).toBeDisabled()
  await modal.getByLabel("Nomor Telepon (Opsional)").fill("812345678901")
  await save.click()
  await expect(modal).toBeHidden()
  const id = await seed.adopt("client", name)

  await page.getByPlaceholder("Cari nama klien...").fill(seed.prefix)
  const row = page.getByRole("row", { name: new RegExp(name) })
  await expect(row).toContainText("AKTIF")
  const link = row.getByRole("link", { name, exact: true })
  await expect(link).toHaveAttribute("href", `/clients/${id}`)
  await link.click()

  await expect(page.getByRole("heading", { name, level: 2 })).toBeVisible()
  // The server assigns the four-digit number.
  await expect(page.getByText(/^Nomor Klien \d{4}$/)).toBeVisible()
  await expect(contactsCard(page)).toContainText(`${seed.prefix} Rina`)
})

test("a contact's email and title can be cleared", async ({ page, seed }) => {
  const client = await seed.client()
  await page.goto(`/clients/${client.id}`)
  const card = contactsCard(page)
  const contactName = `${seed.prefix} Narahubung`
  await card.getByRole("button", { name: `Ubah narahubung ${contactName}` }).click()
  await expect(card.getByLabel("Jabatan")).toHaveValue("Purchasing")
  await card.getByLabel("Jabatan").fill("")
  await card.getByLabel("Email").fill("")
  await card.getByRole("button", { name: "Simpan", exact: true }).click()

  // MD-06: an emptied email or title is removed, not kept.
  await expect
    .poll(async () => {
      const [c] = await api<Contact[]>("GET", `/clients/${client.id}/contacts`)
      return [c.email ?? null, c.title ?? null, c.phone]
    })
    .toEqual([null, null, "81234567890"])
  await expect(card).not.toContainText(client.contactEmail ?? "")
  await expect(card).not.toContainText("Purchasing")
})

test("renaming and deactivating a client saves both", async ({ page, seed }) => {
  const client = await seed.client()
  const renamed = seed.name("Klien Ganti Nama")
  await page.goto(`/clients/${client.id}`)
  const save = page.getByRole("button", { name: "Simpan Perubahan" })
  await expect(save).toBeDisabled()
  await page.getByLabel("Nama Klien *").fill(renamed)
  await page.getByRole("switch", { name: "Status Klien" }).click()
  await save.click()

  await expect
    .poll(async () => {
      const c = await api<{ name: string; isActive: boolean }>("GET", `/clients/${client.id}`)
      return [c.name, c.isActive]
    })
    .toEqual([renamed, false])

  await page.getByRole("complementary").getByRole("link", { name: "Daftar Klien" }).click()
  await page.getByPlaceholder("Cari nama klien...").fill(seed.prefix)
  const row = page.getByRole("row", { name: new RegExp(renamed) })
  await expect(row).toContainText("NONAKTIF")
  expect(
    idFrom(await row.getByRole("link", { name: renamed, exact: true }).getAttribute("href")),
  ).toBe(client.id)

  // A deactivated client is not offered for a new quotation.
  await page.goto("/quotations/add")
  await page.getByLabel("Cari klien").fill(seed.prefix)
  await expect(page.getByRole("button", { name: new RegExp(renamed) })).toHaveCount(0)
})

test.describe("as finance", () => {
  test.use({ session: "finance" })

  test("finance reads a client's detail and contacts", async ({ page, seed }) => {
    const client = await seed.client()
    await page.goto("/clients")
    await page.getByPlaceholder("Cari nama klien...").fill(seed.prefix)
    await page.getByRole("link", { name: client.name, exact: true }).click()
    await expect(page.getByRole("heading", { name: client.name, level: 2 })).toBeVisible()
    await expect(contactsCard(page)).toContainText(`${seed.prefix} Narahubung`)
  })
})

test("the status filter separates active and inactive clients", async ({ page, seed }) => {
  const kept = await seed.client({ label: "Klien Aktif" })
  const dropped = await seed.client({ label: "Klien Nonaktif" })
  await deactivate("client", dropped.id)

  await page.goto("/clients")
  await page.getByPlaceholder("Cari nama klien...").fill(seed.prefix)
  const rows = page.getByRole("row", { name: new RegExp(seed.prefix) })
  await expect(rows).toHaveCount(2)
  await page.getByRole("button", { name: "Filter" }).click()
  const filter = page.getByRole("dialog", { name: "Filter Klien" })
  await filter.getByRole("button", { name: "Nonaktif" }).click()
  await filter.getByRole("button", { name: "Terapkan" }).click()
  await expect(rows).toHaveCount(1)
  await expect(rows).toContainText(dropped.name)
  await expect(rows).toContainText("NONAKTIF")
  await expect(page.getByRole("link", { name: kept.name, exact: true })).toHaveCount(0)
})

// 1x1 transparent PNG.
const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
)

test("a logo over 2 MB is refused and a small one is saved", async ({ page, seed }) => {
  const client = await seed.client()
  await page.goto(`/clients/${client.id}`)
  const input = page.locator('input[type="file"][accept^="image/png"]')
  const logo = page.getByRole("button", { name: "Ganti logo klien" })

  await input.setInputFiles({
    name: "logo-besar.png",
    mimeType: "image/png",
    buffer: Buffer.alloc(2 * 1024 * 1024 + 1, 1),
  })
  // MD-13: the rejected file never shows as if saved.
  await expect(page.getByText("Ukuran logo klien melebihi 2 MB.")).toBeVisible()
  await expect(logo.locator("img")).toHaveCount(0)

  await input.setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: tinyPng })
  await expect(logo.locator("img")).toHaveCount(1)
  await expect
    .poll(
      async () =>
        (await api<{ logoObjectKey?: string }>("GET", `/clients/${client.id}`)).logoObjectKey,
    )
    .toMatch(new RegExp(`^clients/${client.id}/.*logo\\.png$`))

  // Stored logo loads as blob.
  await page.reload()
  await expect(logo.locator("img")).toHaveAttribute("src", /^blob:/)
})

// Phone takes 9-12 digits.
const PHONE_ERROR = "Nomor telepon harus 9–12 digit angka."

test("Tambah Klien refuses a 13-digit phone inline", async ({ page, seed }) => {
  await page.goto("/clients")
  await page.getByRole("button", { name: "Tambah Klien" }).click()
  const modal = page.getByRole("dialog", { name: "Tambah Klien" })
  const save = modal.getByRole("button", { name: "Simpan Data" })
  await modal.getByLabel("Nama Perusahaan *").fill(seed.name("Klien Telepon"))
  await modal.getByLabel("Nama Narahubung *").fill(`${seed.prefix} Rina`)
  await modal.getByLabel("Nomor Telepon (Opsional)").fill("8123456789012")
  await expect(modal.getByText(PHONE_ERROR)).toBeVisible()
  await expect(save).toBeDisabled()
  await modal.getByLabel("Nomor Telepon (Opsional)").fill("812345678901")
  await expect(modal.getByText(PHONE_ERROR)).toBeHidden()
  await expect(save).toBeEnabled()
  await modal.getByRole("button", { name: "Batal" }).click()
  await expect(modal).toBeHidden()
})

test("Tambah Klien refuses an NPWP short of 16 digits inline", async ({ page, seed }) => {
  await page.goto("/clients")
  await page.getByRole("button", { name: "Tambah Klien" }).click()
  const modal = page.getByRole("dialog", { name: "Tambah Klien" })
  const save = modal.getByRole("button", { name: "Simpan Data" })
  await modal.getByLabel("Nama Perusahaan *").fill(seed.name("Klien NPWP"))
  await modal.getByLabel("Nama Narahubung *").fill(`${seed.prefix} Rina`)
  await modal.getByLabel("Nomor Telepon (Opsional)").fill("812345678901")
  await modal.getByLabel("NPWP (Opsional)").fill("012345678901000")
  await expect(modal.getByText("NPWP harus 16 digit angka.")).toBeVisible()
  await expect(save).toBeDisabled()
  await modal.getByLabel("NPWP (Opsional)").fill("0123456789012345")
  await expect(modal.getByText("NPWP harus 16 digit angka.")).toBeHidden()
  await expect(save).toBeEnabled()
  await modal.getByRole("button", { name: "Batal" }).click()
  await expect(modal).toBeHidden()
})

test("a contact edit refuses a 13-digit phone", async ({ page, seed }) => {
  const client = await seed.client()
  await page.goto(`/clients/${client.id}`)
  const card = contactsCard(page)
  await card.getByRole("button", { name: `Ubah narahubung ${seed.prefix} Narahubung` }).click()
  await card.getByLabel("No HP").fill("8123456789012")
  await expect(card.getByText(PHONE_ERROR)).toBeVisible()
  await expect(card.getByRole("button", { name: "Simpan", exact: true })).toBeDisabled()
  await card.getByLabel("No HP").fill("812345678901")
  await expect(card.getByText(PHONE_ERROR)).toBeHidden()
  await card.getByRole("button", { name: "Simpan", exact: true }).click()

  await expect
    .poll(async () => (await api<Contact[]>("GET", `/clients/${client.id}/contacts`))[0].phone)
    .toBe("812345678901")
})

// Failed summary shows a dash.
test("the KPI cards show a dash, not zero, without a summary", async ({ page }) => {
  await page.route("**/api/v1/clients/summary", (route) =>
    route.fulfill({
      status: 404,
      contentType: "application/problem+json",
      body: JSON.stringify({ type: "about:blank", title: "Tidak ditemukan", status: 404 }),
    }),
  )
  await page.goto("/clients")
  const card = page.getByText("Total Klien", { exact: true }).locator("xpath=..")
  await expect(card).toContainText("–")
  await expect(card).not.toContainText("0")
})

// Total Pembelian reads the PO.
//
// A PO edited after acceptance is what is delivered and invoiced, so the
// client and vendor lists total its lines, not the accepted quotation.
test("Total Pembelian follows the PO lines once they are edited", async ({ page, seed }) => {
  const client = await seed.client()
  const vendor = await seed.vendor()
  const item = await seed.item({ vendor, cost: 100_000 })
  const q = await seed.quotation({ client, lines: [{ item, qty: 3, price: 150_000 }] })
  const po = await seed.accept(q.id)
  const lines = await api<PurchaseOrderItemRow[]>("GET", `/purchase-orders/${po.id}/items`)
  const line = lines.find((l) => l.itemType === "product")
  if (!line) throw new Error("the PO has no product line")
  await api(
    "PUT",
    `/purchase-orders/${po.id}/items`,
    {
      discountPct: "0",
      items: [
        {
          quotationItemId: line.quotationItemId,
          offeredItemId: line.offeredItemId,
          vendorProductId: line.vendorProductId,
          itemName: line.itemName,
          qty: "1",
          unitId: line.unitId,
          sellingPrice: "150000",
          costPrice: "80000",
        },
      ],
    },
    { "If-Match": String(po.rowVersion) },
  )
  const edited = await seed.poByQuotation(q.id)
  // 150.000 plus PPN; the quotation would read 499.500.
  expect(edited.poGrandTotal).toBe("166500.00")

  await page.goto("/clients")
  await page.getByPlaceholder("Cari nama klien...").fill(client.name)
  await expect(page.getByRole("row", { name: new RegExp(client.name) })).toContainText(
    rupiah(166_500),
  )

  await page.goto("/vendors")
  await page.getByPlaceholder("Cari nama, negara asal vendor...").fill(vendor.name)
  await expect(page.getByRole("row", { name: new RegExp(vendor.name) })).toContainText(
    rupiah(80_000),
  )
})

// Table edit survives the form.
//
// No HP on the company form is the main contact's phone. A phone changed in
// the contacts table must show in the form and must not be written back by
// a later Simpan Perubahan.
test("a main contact edit in the table survives a company save", async ({ page, seed }) => {
  const client = await seed.client()
  await page.goto(`/clients/${client.id}`)
  const card = contactsCard(page)
  await card.getByRole("button", { name: `Ubah narahubung ${seed.prefix} Narahubung` }).click()
  await card.getByLabel("No HP").fill("812345678901")
  await card.getByRole("button", { name: "Simpan", exact: true }).click()
  await expect
    .poll(async () => (await api<Contact[]>("GET", `/clients/${client.id}/contacts`))[0].phone)
    .toBe("812345678901")

  await expect(page.getByLabel("No HP").first()).toHaveValue("812345678901")
  const address = `${seed.prefix} Jl. Pelabuhan 1`
  await page.getByLabel("Alamat Rinci").fill(address)
  await page.getByRole("button", { name: "Simpan Perubahan" }).click()
  await expect
    .poll(async () => (await api<{ address?: string }>("GET", `/clients/${client.id}`)).address)
    .toBe(address)
  const [main] = await api<Contact[]>("GET", `/clients/${client.id}/contacts`)
  expect(main.phone).toBe("812345678901")
})
