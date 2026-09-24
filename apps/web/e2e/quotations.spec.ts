import type { Locator, Page } from "@playwright/test"
import { api, deactivate, idFrom, rupiah } from "./support/sales"
import { expect, test } from "./support/seed"

// Quotation flows through the UI.
//
// The wizard, the server-driven status machine, Buat Revisi and the PO an
// acceptance creates.

type Request = { requestText: string; matchStatus: string }

// Amount next to a label.
function amountAfter(scope: Locator, label: string): Locator {
  return scope.getByText(label, { exact: true }).locator("xpath=following-sibling::*[1]")
}

function costBreakdown(page: Page): Locator {
  return page.getByRole("heading", { name: "Rincian Biaya" }).locator("xpath=..")
}

// Rupiah figure after a label.
function figure(text: string, label: string): number {
  const m = text.match(new RegExp(`${label}\\s*Rp\\s*([\\d.]+)`))
  if (!m) throw new Error(`${label} not found`)
  return Number(m[1].replaceAll(".", ""))
}

async function openStatusMenu(page: Page, current: string): Promise<Locator> {
  await page.getByRole("button", { name: `Status ${current}, ubah status` }).click()
  return page.getByRole("menu")
}

async function expectStatus(page: Page, label: string): Promise<void> {
  await expect(page.getByRole("button", { name: new RegExp(`^Status ${label}`) })).toBeVisible()
}

test.describe("quotation wizard", () => {
  test("creates a draft through the four steps and the detail repeats its totals", async ({
    page,
    seed,
  }) => {
    const client = await seed.client()
    const vendor = await seed.vendor()
    const item = await seed.item({ vendor, cost: 100_000 })

    await page.goto("/quotations")
    await page.getByRole("button", { name: "Quotation Baru" }).click()
    await expect(page.getByRole("button", { name: "Lanjut" })).toBeDisabled()

    await page.getByLabel("Cari klien").fill(seed.prefix)
    await page.getByRole("button", { name: new RegExp(client.name) }).click()
    await page.getByRole("button", { name: "Lanjut" }).click()

    await page.getByRole("button", { name: "Tambah Produk" }).click()
    const product = page.getByRole("dialog", { name: "Tambah Produk ke Quotation" })
    await product.getByLabel("Kode IMPA/Nama Produk Request *").fill(item.name)
    await product.getByRole("button", { name: `${item.impaCode} - ${item.name}` }).click()
    await product.getByLabel("Kode IMPA/Nama Produk *", { exact: true }).fill(item.name)
    await product.getByRole("button", { name: `${item.impaCode} - ${item.name}` }).click()
    await expect(product.getByRole("button", { name: "Satuan *" })).toHaveText(/PCS/)
    await product.getByLabel("Jumlah Produk *").fill("4")
    await product.getByLabel("Nama Vendor *").click()
    await product.getByRole("button", { name: new RegExp(vendor.name) }).click()
    await expect(product.getByLabel("Harga Beli Satuan *")).toHaveValue("100000")
    await product.getByLabel("Harga Jual Satuan *").fill("150000")
    await product.getByRole("button", { name: "Simpan Data" }).click()
    await expect(product).toBeHidden()

    await page.getByRole("button", { name: "Tambah Diskon" }).click()
    const discount = page.getByRole("dialog", { name: "Tambah Diskon Pembayaran" })
    await discount.getByLabel("Persentase Diskon *").fill("10")
    await discount.getByRole("button", { name: "Simpan Data" }).click()
    await expect(page.getByRole("button", { name: "Diskon (10%)" })).toBeVisible()
    await page.getByRole("button", { name: "Lanjut" }).click()

    const cost = page.getByLabel("Biaya Pengiriman *")
    await expect(cost).toBeDisabled()
    await page.getByLabel("Alamat Lengkap *").fill("Jl. Pelabuhan Raya No. 12, Tanjung Priok")
    await page.getByLabel("Waktu Pengiriman (Hari) *").fill("7")
    await cost.fill("250000")
    await page.getByRole("button", { name: "Lanjut" }).click()

    const create = page.getByRole("button", { name: "Buat Penawaran" })
    await expect(create).toBeDisabled()
    await page.getByLabel("JATUH TEMPO PEMBAYARAN (HARI) *").fill("30")
    await page.getByLabel("BERLAKU SAMPAI (HARI) *").fill("14")
    const summary = (await page.locator("main").textContent()) ?? ""
    // 4 x 150.000 less 10%, minus 4 x 100.000 cost.
    expect(figure(summary, "Total Estimasi Profit")).toBe(140_000)
    const wizardTotal = figure(summary, "Grand Total")
    await create.click()

    await expect(page).toHaveURL(/\/quotations$/)
    await page.getByPlaceholder("Cari penawaran, klien, atau nomor...").fill(seed.prefix)
    const row = page.getByRole("row", { name: new RegExp(client.name) })
    await expect(row).toHaveCount(1)
    await expect(row).toContainText("Draf")
    const link = row.getByRole("link").first()
    seed.track("quotation", idFrom(await link.getAttribute("href")))
    await link.click()

    await expectStatus(page, "Draf")
    const breakdown = costBreakdown(page)
    await expect(amountAfter(breakdown, "Grand Total")).toHaveText(rupiah(wizardTotal))
    // Q-10: the detail profit is taken after the discount, like the wizard.
    await expect(amountAfter(breakdown, "Total Estimasi Profit")).toHaveText(rupiah(140_000))
  })

  test("a client added inside the wizard is the one selected", async ({ page, seed }) => {
    const name = seed.name("Klien Wizard")
    await page.goto("/quotations/add")
    await page.getByRole("button", { name: "Tambah Klien Baru" }).click()
    const modal = page.getByRole("dialog", { name: "Tambah Klien" })
    await modal.getByLabel("Nama Perusahaan *").fill(name)
    await modal.getByLabel("Alamat *").fill("Jl. Gatot Subroto Kav. 10, Jakarta Selatan")
    await modal.getByLabel("Nama Narahubung *").fill(`${seed.prefix} Narahubung`)
    // One of phone or email is required, despite both reading Opsional.
    await modal
      .getByLabel("Email (Opsional)")
      .fill(`${seed.prefix.toLowerCase()}.wizard@example.com`)
    await modal.getByRole("button", { name: "Simpan Data" }).click()
    await expect(modal).toBeHidden()
    await seed.adopt("client", name)

    // Q-6: the wizard moves on with the new client, not an empty choice.
    await expect(page.getByRole("heading", { name: "Pilih Produk & Harga" })).toBeVisible()
    await page.getByRole("button", { name: "Kembali" }).click()
    await expect(page.getByRole("button", { name: new RegExp(name) })).toHaveAttribute(
      "aria-pressed",
      "true",
    )
    await expect(page.getByRole("button", { name: "Lanjut" })).toBeEnabled()
  })

  test("Salin ke Offer keeps the catalog item's vendors and unit", async ({ page, seed }) => {
    const client = await seed.client()
    const vendor = await seed.vendor()
    const item = await seed.item({ vendor, cost: 75_000 })

    await page.goto("/quotations/add")
    await page.getByLabel("Cari klien").fill(seed.prefix)
    await page.getByRole("button", { name: new RegExp(client.name) }).click()
    await page.getByRole("button", { name: "Lanjut" }).click()
    await page.getByRole("button", { name: "Tambah Produk" }).click()

    const product = page.getByRole("dialog", { name: "Tambah Produk ke Quotation" })
    await product.getByLabel("Kode IMPA/Nama Produk Request *").fill(item.name)
    await product.getByRole("button", { name: `${item.impaCode} - ${item.name}` }).click()
    await product.getByRole("button", { name: "Salin ke Offer" }).click()
    await expect(product.getByLabel("Kode IMPA/Nama Produk *", { exact: true })).toHaveValue(
      `${item.impaCode} - ${item.name}`,
    )
    // The copied offer is the same catalog item, so its linked vendor and
    // default unit apply exactly as when the offer is picked directly.
    await expect(product.getByRole("button", { name: "Satuan *" })).toHaveText(/PCS/)
    await product.getByLabel("Jumlah Produk *").fill("2")
    await product.getByLabel("Nama Vendor *").click()
    await product.getByRole("button", { name: new RegExp(vendor.name) }).click()
    await expect(product.getByLabel("Harga Beli Satuan *")).toHaveValue("75000")
  })
})

test.describe("quotation wizard import and requests", () => {
  test("an Excel/CSV import matches the catalog and creates the rest", async ({ page, seed }) => {
    const client = await seed.client()
    const cheap = await seed.vendor({ label: "Vendor Murah" })
    const active = await seed.vendor({ label: "Vendor Aktif" })
    const item = await seed.item({ vendor: active, cost: 90_000 })
    await seed.linkVendor(item, cheap, 50_000)
    await deactivate("vendor", cheap.id)
    // No shared words, so fuzzy matching cannot tie it to a seeded item.
    const fresh = `Qzvx ${seed.prefix.slice(3).toLowerCase()} wkjh`
    const csv = [
      "No,Kode IMPA,Nama Produk,Jumlah,Satuan",
      `1,${item.impaCode},${item.name},3,PCS`,
      `2,,${fresh},2,PCS`,
    ].join("\n")

    await page.goto("/quotations/add")
    await page.getByLabel("Cari klien").fill(seed.prefix)
    await page.getByRole("button", { name: new RegExp(client.name) }).click()
    await page.getByRole("button", { name: "Lanjut" }).click()
    await page.locator('input[type="file"][accept=".csv,.xlsx"]').setInputFiles({
      name: "permintaan.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv),
    })
    await expect(
      page.getByText("2 produk diimport (1 cocok katalog, 1 produk baru, harga kosong)."),
    ).toBeVisible()
    await seed.adopt("item", fresh)

    const main = page.locator("main")
    await expect(main).toContainText(`KODE IMPA: ${item.impaCode}`)
    await expect(main).toContainText(fresh)
    // MD-01: the deactivated cheaper vendor never supplies the price.
    await expect(main).toContainText(active.name)
    await expect(main).not.toContainText(cheap.name)
    await expect(main).toContainText("Rp 90.000")
  })

  test("a draft's client requests are added, reviewed and removed", async ({ page, seed }) => {
    const client = await seed.client()
    const item = await seed.item()
    const q = await seed.quotation({ client, lines: [{ item, qty: 1, price: 10_000 }] })
    const text = `${seed.prefix} tali tambang 12mm`

    await page.goto(`/quotations/${q.id}/edit`)
    await page.getByRole("button", { name: "Lanjut" }).click()
    const expand = page.getByRole("button", { name: "Tampilkan" })
    if (await expand.isVisible()) await expand.click()
    await page.getByRole("button", { name: "+ Tambah Permintaan" }).click()
    await page.getByLabel("Deskripsi permintaan").fill(text)
    await page.getByLabel("Kode IMPA", { exact: true }).last().fill("210101")
    await page.getByLabel("Jumlah diminta").fill("4")
    await page.getByLabel("Satuan diminta").fill("MTR")
    await page.getByRole("button", { name: "Simpan", exact: true }).first().click()

    const row = page.getByRole("row", { name: new RegExp(text) })
    await expect(row).toBeVisible()
    await row.getByRole("combobox").selectOption({ label: "Tidak Tersedia" })
    await expect
      .poll(async () =>
        (await api<Request[]>("GET", `/quotations/${q.id}/requests`)).map((r) => [
          r.requestText,
          r.matchStatus,
        ]),
      )
      .toEqual([[text, "unavailable"]])

    page.once("dialog", (d) => void d.accept())
    await row.getByRole("button", { name: "Hapus" }).click()
    await expect(row).toHaveCount(0)
    expect(await api<Request[]>("GET", `/quotations/${q.id}/requests`)).toEqual([])
  })
})

test.describe("quotation status", () => {
  test("a draft is edited, sent, and then loses Ubah", async ({ page, seed }) => {
    const client = await seed.client()
    const item = await seed.item()
    const q = await seed.quotation({
      client,
      lines: [{ item, qty: 2, price: 120_000, cost: 90_000 }],
      notes: "Kirim sebelum akhir bulan",
      vesselName: "MV Sinar Bahari",
    })

    await page.goto(`/quotations/${q.id}`)
    await expectStatus(page, "Draf")
    await expect(page.getByText("Kirim quotation ke klien sebelum")).toBeVisible()
    // PO-11 on the quotation: the card reads the client, not "Belum diisi".
    const card = page.getByRole("heading", { name: "Ringkasan Klien" }).locator("xpath=..")
    await expect(card.getByRole("link", { name: client.name })).toHaveAttribute(
      "href",
      `/clients/${client.id}`,
    )
    await expect(card).toContainText("0123456789012345")
    await expect(card).toContainText(client.contactEmail ?? "")
    await page.getByRole("button", { name: "Ubah", exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/quotations/${q.id}/edit$`))
    for (let step = 0; step < 3; step++) {
      await page.getByRole("button", { name: "Lanjut" }).click()
    }
    // The editor summary reads the client too, not "Belum diisi".
    const summary = page.getByRole("heading", { name: "Ringkasan Klien" }).locator("xpath=..")
    await expect(summary).toContainText("0123456789012345")
    await expect(summary).toContainText("Jl. Pelabuhan Raya No. 12, Tanjung Priok, Jakarta Utara")
    await expect(summary).toContainText(client.contactEmail ?? "")
    await page.getByRole("button", { name: "Simpan" }).click()
    await expect(page).toHaveURL(new RegExp(`/quotations/${q.id}$`))
    // Q-11: saving the editor keeps the fields it does not show.
    await expect
      .poll(async () => {
        const saved = await seed.getQuotation(q.id)
        return [saved.vesselName, saved.notes]
      })
      .toEqual(["MV Sinar Bahari", "Kirim sebelum akhir bulan"])

    const menu = await openStatusMenu(page, "Draf")
    await expect(menu.getByRole("menuitem")).toHaveText(["Dikirim"])
    await menu.getByRole("menuitem", { name: "Dikirim" }).click()
    const dialog = page.getByRole("dialog", { name: "Ubah Status ke Dikirim" })
    await dialog.getByRole("button", { name: "Simpan Status" }).click()
    await expect(dialog).toBeHidden()

    await expectStatus(page, "Dikirim")
    // Q-9: a sent quotation offers no Ubah; revising is the way to change it.
    await expect(page.getByRole("button", { name: "Ubah", exact: true })).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Buat Revisi" })).toBeVisible()
    await expect(page.getByRole("button", { name: "Batalkan", exact: true })).toBeVisible()
    const next = await openStatusMenu(page, "Dikirim")
    await expect(next.getByRole("menuitem")).toHaveText(["Disetujui", "Ditolak"])

    await page.goto(`/quotations/${q.id}/edit`)
    await expect(page.getByText("Quotation tidak dapat diubah")).toBeVisible()
    await expect(page.getByText("Gunakan Buat Revisi di halaman detail")).toBeVisible()
  })

  test("the editor switches a draft to another contact", async ({ page, seed }) => {
    const client = await seed.client()
    const item = await seed.item()
    const second = `${seed.prefix} Narahubung Kedua`
    const secondId = await seed.contact(client, second)
    const q = await seed.quotation({ client, lines: [{ item, qty: 1, price: 25_000 }] })

    await page.goto(`/quotations/${q.id}/edit`)
    await expect(
      page.getByText("Klien tidak dapat diganti setelah quotation dibuat."),
    ).toBeVisible()
    await page.getByRole("button", { name: new RegExp(`^${second}`) }).click()
    await expect(page.getByRole("button", { name: new RegExp(`^${second}`) })).toHaveAttribute(
      "aria-pressed",
      "true",
    )
    for (let step = 0; step < 3; step++) {
      await page.getByRole("button", { name: "Lanjut" }).click()
    }
    await page.getByRole("button", { name: "Simpan" }).click()
    await expect(page).toHaveURL(new RegExp(`/quotations/${q.id}$`))
    await expect.poll(async () => (await seed.getQuotation(q.id)).contactId).toBe(secondId)
    const card = page.getByRole("heading", { name: "Ringkasan Klien" }).locator("xpath=..")
    await expect(card).toContainText(second)
  })

  test("Ditolak waits for a reason and is final", async ({ page, seed }) => {
    const client = await seed.client()
    const item = await seed.item()
    const q = await seed.quotation({ client, lines: [{ item, qty: 1, price: 50_000 }] })
    await seed.send(q.id)
    const reason = `${seed.prefix} harga di atas anggaran klien`

    await page.goto(`/quotations/${q.id}`)
    const menu = await openStatusMenu(page, "Dikirim")
    await menu.getByRole("menuitem", { name: "Ditolak" }).click()
    const dialog = page.getByRole("dialog", { name: "Ubah Status ke Ditolak" })
    const submit = dialog.getByRole("button", { name: "Simpan Status" })
    await expect(submit).toBeDisabled()
    await dialog.getByLabel(/Alasan/).fill("   ")
    await expect(submit).toBeDisabled()
    await dialog.getByLabel(/Alasan/).fill(reason)
    await submit.click()
    await expect(dialog).toBeHidden()

    await expect(page.getByRole("button", { name: "Status Ditolak", exact: true })).toBeDisabled()
    await expect(page.getByText("Status akhir. Status tidak dapat diubah lagi.")).toBeVisible()
    await expect(page.getByRole("button", { name: "Buat Revisi" })).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Batalkan", exact: true })).toHaveCount(0)
    await expect(page.getByText(reason)).toBeVisible()
    expect((await seed.getQuotation(q.id)).status).toBe("rejected")
  })

  test("Batalkan withdraws a draft and the list still renders it", async ({ page, seed }) => {
    const client = await seed.client()
    const item = await seed.item()
    const q = await seed.quotation({ client, lines: [{ item, qty: 3, price: 20_000 }] })

    await page.goto(`/quotations/${q.id}`)
    await page.getByRole("button", { name: "Batalkan", exact: true }).click()
    const dialog = page.getByRole("dialog", { name: "Batalkan Quotation" })
    const submit = dialog.getByRole("button", { name: "Batalkan Quotation" })
    await expect(submit).toBeDisabled()
    await dialog.getByLabel(/Alasan/).fill("Klien menunda pengadaan")
    await submit.click()
    await expect(dialog).toBeHidden()

    await expect(
      page.getByRole("button", { name: "Status Dibatalkan", exact: true }),
    ).toBeDisabled()
    await expect(page.getByRole("button", { name: "Ubah", exact: true })).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Batalkan", exact: true })).toHaveCount(0)

    // A cancelled row once crashed the list on a missing badge.
    await page.getByRole("navigation").getByRole("link", { name: "Quotation", exact: true }).click()
    await page.getByPlaceholder("Cari penawaran, klien, atau nomor...").fill(seed.prefix)
    await expect(page.getByRole("row", { name: new RegExp(q.quotationNo) })).toContainText(
      "Dibatalkan",
    )
  })

  test("Buat Revisi opens a new draft and freezes the original", async ({ page, seed }) => {
    const client = await seed.client()
    const item = await seed.item()
    const q = await seed.quotation({ client, lines: [{ item, qty: 5, price: 40_000 }] })
    await seed.send(q.id)

    await page.goto(`/quotations/${q.id}`)
    await page.getByRole("button", { name: "Buat Revisi" }).click()
    const dialog = page.getByRole("dialog", { name: "Buat Revisi" })
    await dialog.getByLabel("Catatan revisi (opsional)").fill("Klien meminta harga baru")
    await dialog.getByRole("button", { name: "Buat Revisi" }).click()

    await expect(page).toHaveURL(/\/quotations\/\d+\/edit$/)
    await expect(page.getByRole("heading", { name: "Edit Quotation" })).toBeVisible()
    const draftId = idFrom(page.url())
    seed.track("quotation", draftId)
    expect(draftId).not.toBe(q.id)
    const draft = await seed.getQuotation(draftId)
    expect(draft).toMatchObject({ status: "draft", version: 2 })
    expect(draft.quotationNo).toBe(`${q.quotationNo} Rev.1`)

    await page.goto(`/quotations/${q.id}`)
    await expectStatus(page, "Revisi")
    await expect(page.getByRole("button", { name: "Ubah", exact: true })).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Buat Revisi" })).toHaveCount(0)
    const menu = await openStatusMenu(page, "Revisi")
    await expect(menu.getByRole("menuitem")).toHaveText(["Ditolak"])
    await page.keyboard.press("Escape")

    const revisions = page.getByRole("heading", { name: "Riwayat Revisi" }).locator("xpath=..")
    const newer = revisions.getByRole("link", { name: draft.quotationNo })
    await expect(newer).toHaveAttribute("href", `/quotations/${draftId}`)
    await newer.click()
    await expect(
      page.getByRole("heading", { name: `Quotation ${draft.quotationNo}` }),
    ).toBeVisible()
    await expect(page.getByText("Versi 2", { exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: "Ubah", exact: true })).toBeVisible()
  })

  test.describe("as operational", () => {
    test.use({ session: "operational" })

    test("Disetujui creates a PO the PO list shows without a reload", async ({ page, seed }) => {
      const client = await seed.client()
      const item = await seed.item()
      const q = await seed.quotation({ client, lines: [{ item, qty: 2, price: 75_000 }] })
      await seed.send(q.id)
      const nav = page.getByRole("navigation")
      const poSearch = page.getByPlaceholder("Cari purchase order, klien, atau nomor...")

      // Cache the PO list for this client while it is still empty.
      await page.goto("/purchase-orders")
      const searched = page.waitForResponse(
        (r) => r.url().includes("/purchase-orders?") && r.url().includes(seed.prefix),
      )
      await poSearch.fill(seed.prefix)
      await searched
      await expect(page.getByText("Belum ada Purchase Order.")).toBeVisible()

      await nav.getByRole("link", { name: "Quotation", exact: true }).click()
      await page.getByPlaceholder("Cari penawaran, klien, atau nomor...").fill(seed.prefix)
      await page.getByRole("link", { name: q.quotationNo }).click()
      const menu = await openStatusMenu(page, "Dikirim")
      await menu.getByRole("menuitem", { name: "Disetujui" }).click()
      const dialog = page.getByRole("dialog", { name: "Ubah Status ke Disetujui" })
      await expect(dialog).toContainText("langsung membuat PO")
      await dialog.getByRole("button", { name: "Setujui" }).click()
      await expect(
        page.getByRole("button", { name: "Status Disetujui", exact: true }),
      ).toBeDisabled()
      await expect(page.getByText("PO sudah dibuat")).toBeVisible()

      // Q-8: the accepted quotation's PO is there on the next visit.
      await nav.getByRole("link", { name: "Purchase Order", exact: true }).click()
      await poSearch.fill(seed.prefix)
      const row = page.getByRole("row", { name: new RegExp(client.name) })
      await expect(row).toHaveCount(1)
      await expect(row).toContainText("Pending")
      await expect(row.getByRole("link", { name: /^Q-/ })).toHaveAttribute(
        "href",
        `/quotations/${q.id}`,
      )
    })
  })
})

test.describe("quotation list", () => {
  test("a status filter narrows the search and its chip removes it", async ({ page, seed }) => {
    const client = await seed.client()
    const item = await seed.item()
    const lines = [{ item, qty: 1, price: 30_000 }]
    const open = await seed.quotation({ client, lines })
    const dropped = await seed.quotation({ client, lines })
    await seed.setQuotationStatus(dropped.id, "cancelled", "Klien tidak jadi memesan")

    await page.goto("/quotations")
    await page.getByPlaceholder("Cari penawaran, klien, atau nomor...").fill(seed.prefix)
    const rows = page.getByRole("row", { name: new RegExp(client.name) })
    await expect(rows).toHaveCount(2)

    await page.getByRole("button", { name: "Filter" }).click()
    const filter = page.getByRole("dialog", { name: "Filter Quotation" })
    await filter
      .getByRole("group", { name: "Status Quotation" })
      .getByRole("button", { name: "Dibatalkan" })
      .click()
    await filter.getByRole("button", { name: "Terapkan" }).click()
    await expect(rows).toHaveCount(1)
    await expect(rows).toContainText(dropped.quotationNo)
    await expect(rows).toContainText("Dibatalkan")

    // Removing the chip keeps the search in place.
    await page.getByRole("button", { name: "Hapus filter Status: Dibatalkan" }).click()
    await expect(rows).toHaveCount(2)
    await expect(page.getByRole("link", { name: open.quotationNo })).toBeVisible()
    await expect(page.getByPlaceholder("Cari penawaran, klien, atau nomor...")).toHaveValue(
      seed.prefix,
    )
  })
})
