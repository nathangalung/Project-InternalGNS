import type { Page } from "@playwright/test"
import { api, deactivate, idFrom } from "./support/sales"
import { expect, test } from "./support/seed"

// Client master data through the UI: create, edit, contacts, deactivate.

type Contact = { id: number; name: string; email?: string; title?: string; phone?: string }

// Contact card on the client detail page.
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
  await modal.getByLabel("Alamat *").fill("Jl. Raya Pelabuhan No. 8, Surabaya")
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
