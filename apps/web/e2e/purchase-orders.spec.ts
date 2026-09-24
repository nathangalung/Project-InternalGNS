import type { Page } from "@playwright/test"
import { api, pdfFile, rupiah, type SalesSeed, type SeedClient } from "./support/sales"
import { expect, test } from "./support/seed"

// PO flows through the UI.
//
// The PO an accepted quotation creates, its file, the server-driven status
// moves and cancellation.

// Accepted quotation and its PO.
//
// A draft made first keeps the quotation and PO ids apart, so a route that
// mixes them up lands on the wrong row.
async function acceptedPo(
  seed: SalesSeed,
  opts: { client?: SeedClient; discountPct?: number } = {},
) {
  const client = opts.client ?? (await seed.client())
  const vendor = await seed.vendor()
  const item = await seed.item({ vendor, cost: 60_000 })
  const lines = [{ item, qty: 3, price: 100_000, cost: 60_000 }]
  await seed.quotation({ client, lines })
  const q = await seed.quotation({ client, lines, discountPct: opts.discountPct })
  const po = await seed.accept(q.id)
  expect(po.id).not.toBe(q.id)
  return { client, vendor, item, q, po }
}

// Pick and save a move.
async function choosePoStatus(page: Page, current: string, next: string): Promise<void> {
  await page.getByRole("button", { name: current, exact: true }).click()
  await page.getByRole("button", { name: next, exact: true }).click()
  await page.getByRole("button", { name: "Simpan Data" }).click()
}

test.describe("purchase order detail", () => {
  test("links, client card and totals come from the PO", async ({ page, seed }) => {
    const { client, q, po } = await acceptedPo(seed, { discountPct: 10 })

    await page.goto("/purchase-orders")
    await page.getByPlaceholder("Cari purchase order, klien, atau nomor...").fill(seed.prefix)
    const row = page.getByRole("row", { name: new RegExp(client.name) })
    await expect(row).toHaveCount(1)
    // Both PO routes are keyed by the quotation id.
    const poLink = row.getByRole("link", { name: /^PO-/ })
    await expect(poLink).toHaveAttribute("href", `/purchase-orders/${q.id}`)
    await expect(row.getByRole("link", { name: client.name })).toHaveAttribute(
      "href",
      `/clients/${client.id}`,
    )
    await poLink.click()

    await expect(page.getByRole("heading", { name: `Purchase Order ${po.poNumber}` })).toBeVisible()
    await expect(page.getByRole("link", { name: q.quotationNo })).toHaveAttribute(
      "href",
      `/quotations/${q.id}`,
    )

    const card = page.getByRole("heading", { name: "Ringkasan Klien" }).locator("xpath=..")
    await expect(card.getByRole("link", { name: client.name })).toHaveAttribute(
      "href",
      `/clients/${client.id}`,
    )
    // PO-11: the card shows the client's own data, not "Belum diisi".
    await expect(card).toContainText("0123456789012345")
    await expect(card).toContainText("Jl. Pelabuhan Raya No. 12, Tanjung Priok, Jakarta Utara")
    await expect(card).toContainText(client.contactEmail ?? "")
    await expect(card).toContainText("81234567890")

    // PO-05: the breakdown is the discounted PO the invoice will bill.
    const breakdown = page.getByRole("heading", { name: "Rincian Biaya" }).locator("xpath=..")
    await expect(breakdown).toContainText("Diskon (10%)")
    await expect(
      breakdown.getByText("Grand Total", { exact: true }).locator("xpath=following-sibling::*[1]"),
    ).toHaveText(rupiah(Number(po.poGrandTotal)))
  })

  test("Ubah edits the same PO and saving keeps its discount and notes", async ({ page, seed }) => {
    const { q, po } = await acceptedPo(seed, { discountPct: 5 })
    await seed.setPoNotes(po.id, "Kirim lewat pelabuhan Tanjung Priok")

    await page.goto(`/purchase-orders/${q.id}`)
    await page.getByRole("button", { name: "Ubah", exact: true }).click()
    // PO-01: the edit route resolves the PO through the quotation id too.
    await expect(page).toHaveURL(new RegExp(`/purchase-orders/${q.id}/edit$`))
    await expect(page.getByRole("heading", { name: "Edit Purchase Order" })).toBeVisible()
    // PO-02: the wizard opens with the PO's discount, not zero.
    await expect(page.getByRole("button", { name: "Diskon (5%)" })).toBeVisible()
    await page.getByRole("button", { name: "Lanjut" }).click()
    await page.getByRole("button", { name: "Lanjut" }).click()
    await page.getByRole("button", { name: "Simpan", exact: true }).click()

    await expect(page).toHaveURL(new RegExp(`/purchase-orders/${q.id}$`))
    await expect(page.getByRole("heading", { name: `Purchase Order ${po.poNumber}` })).toBeVisible()
    await expect
      .poll(async () => {
        const saved = await seed.poByQuotation(q.id)
        return [saved.rowVersion > po.rowVersion, saved.discountPct, saved.notes]
      })
      .toEqual([true, "5.00", "Kirim lewat pelabuhan Tanjung Priok"])
    expect((await seed.poByQuotation(q.id)).poGrandTotal).toBe(po.poGrandTotal)
  })

  test("a price changed in the PO editor reprices the PO", async ({ page, seed }) => {
    const { q, po } = await acceptedPo(seed)
    expect(po.poTotalProduk).toBe("300000.00")

    await page.goto(`/purchase-orders/${q.id}/edit`)
    await page.getByRole("button", { name: "Edit produk 1" }).click()
    const modal = page.getByRole("dialog", { name: "Edit Produk Quotation" })
    await expect(modal.getByLabel("Harga Jual Satuan *")).toHaveValue("100000")
    await modal.getByLabel("Harga Jual Satuan *").fill("120000")
    await modal.getByRole("button", { name: "Simpan Perubahan" }).click()
    const confirm = page.getByRole("dialog", { name: "Konfirmasi Perubahan Harga" })
    await expect(confirm).toContainText("Rp100.000 menjadi Rp120.000")
    await confirm.getByRole("button", { name: "Ya, Ubah" }).click()
    await expect(modal).toBeHidden()
    await page.getByRole("button", { name: "Lanjut" }).click()
    await page.getByRole("button", { name: "Lanjut" }).click()
    await page.getByRole("button", { name: "Simpan", exact: true }).click()

    await expect(page).toHaveURL(new RegExp(`/purchase-orders/${q.id}$`))
    await expect.poll(async () => (await seed.poByQuotation(q.id)).poTotalProduk).toBe("360000.00")
    const saved = await seed.poByQuotation(q.id)
    const breakdown = page.getByRole("heading", { name: "Rincian Biaya" }).locator("xpath=..")
    await expect(
      breakdown.getByText("Grand Total", { exact: true }).locator("xpath=following-sibling::*[1]"),
    ).toHaveText(rupiah(Number(saved.poGrandTotal)))
  })
})

test.describe("purchase order file", () => {
  test("uploading moves Pending to PO Diunggah and removing moves it back", async ({
    page,
    seed,
  }) => {
    const { q } = await acceptedPo(seed)
    const clientPo = `${seed.prefix}-PO-KLIEN`

    await page.goto(`/purchase-orders/${q.id}`)
    await expect(page.getByRole("button", { name: "Pending", exact: true })).toBeVisible()
    await page.getByRole("button", { name: "Unggah Berkas" }).click()
    const modal = page.getByRole("dialog", { name: /Upload Berkas Purchase Order/ })
    const upload = modal.getByRole("button", { name: "Upload" })
    await expect(upload).toBeDisabled()
    await modal.getByLabel("Nomor PO *").fill(clientPo)
    await modal.locator('input[type="file"]').setInputFiles(pdfFile("po-klien.pdf"))
    await upload.click()
    await expect(modal).toBeHidden()

    await expect(page.getByRole("heading", { name: `Purchase Order ${clientPo}` })).toBeVisible()
    await expect(page.getByText("po-klien.pdf", { exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: "PO Diunggah", exact: true })).toBeVisible()
    await expect(page.getByText("Berkas PO diunggah")).toBeVisible()
    expect((await seed.poByQuotation(q.id)).status).toBe("UPLOADED")

    await page.getByRole("button", { name: "Hapus Berkas" }).click()
    const confirm = page.getByRole("dialog", { name: "Hapus berkas PO?" })
    await confirm.getByRole("button", { name: "Hapus Berkas" }).click()
    await expect(confirm).toBeHidden()
    await expect(page.getByText("Belum ada berkas PO yang diunggah")).toBeVisible()
    await expect(page.getByRole("button", { name: "Pending", exact: true })).toBeVisible()
    await expect(page.getByText("Berkas PO dihapus")).toBeVisible()
    expect((await seed.poByQuotation(q.id)).status).toBe("PENDING")
  })
})

test.describe("purchase order status", () => {
  test("Dalam Progres is refused until client and vendor data are complete", async ({
    page,
    seed,
  }) => {
    const client = await seed.client({ complete: false })
    const vendor = await seed.vendor({ complete: false })
    const item = await seed.item({ vendor, cost: 10_000 })
    const q = await seed.quotation({ client, lines: [{ item, qty: 1, price: 15_000 }] })
    const po = await seed.accept(q.id)
    await seed.attachPoFile(po)

    await page.goto(`/purchase-orders/${q.id}`)
    await choosePoStatus(page, "PO Diunggah", "Dalam Progres")
    const modal = page.getByRole("dialog", { name: "Data Belum Lengkap" })
    await expect(modal).toBeVisible()
    await expect(modal.getByRole("link", { name: client.name })).toHaveAttribute(
      "href",
      `/clients/${client.id}`,
    )
    await expect(modal.getByRole("link", { name: vendor.name })).toHaveAttribute(
      "href",
      `/vendors/${vendor.id}`,
    )
    await expect(modal.getByRole("listitem").getByText("NPWP", { exact: true })).toBeVisible()
    await expect(modal.getByRole("listitem").getByText("Lokasi", { exact: true })).toBeVisible()
    await modal.getByRole("button", { name: "Mengerti" }).click()
    await expect(modal).toBeHidden()
    expect((await seed.poByQuotation(q.id)).status).toBe("UPLOADED")
  })

  test("Dalam Progres issues the Surat Jalan number", async ({ page, seed }) => {
    const { client, q, po } = await acceptedPo(seed)
    await seed.attachPoFile(po)

    await page.goto(`/purchase-orders/${q.id}`)
    await expect(page.getByRole("button", { name: "Unduh Surat Jalan" })).toBeDisabled()
    await choosePoStatus(page, "PO Diunggah", "Dalam Progres")
    await expect(page).toHaveURL(/\/purchase-orders$/)

    const saved = await seed.poByQuotation(q.id)
    expect(saved.status).toBe("ON_PROGRESS")
    expect(saved.deliveryNoteNumber).toBeTruthy()
    await page.getByPlaceholder("Cari purchase order, klien, atau nomor...").fill(seed.prefix)
    const row = page.getByRole("row", { name: new RegExp(client.name) })
    await expect(row).toContainText("Dalam Progres")
    await expect(
      row.getByRole("button", { name: `Unduh Surat Jalan ${saved.poNumber}` }),
    ).toBeEnabled()

    await page.goto(`/purchase-orders/${q.id}`)
    await expect(page.getByText(`Surat Jalan ${saved.deliveryNoteNumber}`)).toBeVisible()
    await expect(page.getByRole("button", { name: "Unduh Surat Jalan" })).toBeEnabled()
    const menu = page.getByRole("button", { name: "Dalam Progres", exact: true })
    await menu.click()
    await expect(page.getByRole("button", { name: "Dikirim", exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: "Dibatalkan", exact: true })).toBeVisible()
  })

  test("Dikirim delivers the PO and locks its lines", async ({ page, seed }) => {
    const { q, po } = await acceptedPo(seed)
    await seed.attachPoFile(po)
    await seed.setPoStatus(po.id, "ON_PROGRESS")

    await page.goto(`/purchase-orders/${q.id}`)
    await choosePoStatus(page, "Dalam Progres", "Dikirim")
    await expect(page).toHaveURL(/\/purchase-orders$/)
    expect((await seed.poByQuotation(q.id)).status).toBe("DELIVERED")

    await page.goto(`/purchase-orders/${q.id}`)
    await expect(page.getByRole("button", { name: "Dikirim", exact: true })).toBeDisabled()
    await expect(page.getByText("Status ini sudah final dan tidak dapat diubah.")).toBeVisible()
    await expect(page.getByRole("button", { name: "Ubah", exact: true })).toBeDisabled()
    // The file stays; only the number and date remain editable.
    await expect(page.getByRole("button", { name: "Hapus Berkas" })).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Ubah Detail" })).toBeVisible()
    await page.goto(`/purchase-orders/${q.id}/edit`)
    await expect(page.getByText("Purchase Order tidak dapat diubah")).toBeVisible()
  })

  test("Dibatalkan needs a reason and locks the PO", async ({ page, seed }) => {
    const { q } = await acceptedPo(seed)
    const reason = `${seed.prefix} klien membatalkan pesanan`

    await page.goto(`/purchase-orders/${q.id}`)
    // Pending follows the file; the only manual move is cancelling.
    await page.getByRole("button", { name: "Pending", exact: true }).click()
    await expect(page.getByRole("button", { name: "PO Diunggah", exact: true })).toHaveCount(0)
    await page.getByRole("button", { name: "Dibatalkan", exact: true }).click()
    await page.getByRole("button", { name: "Simpan Data" }).click()

    const modal = page.getByRole("dialog", { name: "Ubah status menjadi Dibatalkan" })
    const save = modal.getByRole("button", { name: "Simpan", exact: true })
    await expect(save).toBeDisabled()
    await modal.getByLabel(/Alasan/).fill(reason)
    await save.click()
    await expect(page).toHaveURL(/\/purchase-orders$/)
    expect((await seed.poByQuotation(q.id)).status).toBe("CANCELLED")
    // The quotation keeps its answer; only the PO is withdrawn.
    expect((await seed.getQuotation(q.id)).status).toBe("accepted")

    await page.goto(`/purchase-orders/${q.id}`)
    await expect(page.getByText("Status ini sudah final dan tidak dapat diubah.")).toBeVisible()
    await expect(page.getByRole("button", { name: "Dibatalkan", exact: true })).toBeDisabled()
    await expect(page.getByRole("button", { name: "Ubah", exact: true })).toBeDisabled()
    await expect(page.getByText(reason)).toBeVisible()

    await page.goto(`/purchase-orders/${q.id}/edit`)
    await expect(page.getByText("Purchase Order tidak dapat diubah")).toBeVisible()
  })
})

test.describe("purchase order after invoicing", () => {
  test("a sent invoice freezes the PO number and date", async ({ page, seed }) => {
    const { q, po } = await acceptedPo(seed)
    const invoice = await seed.deliver(po)
    await page.goto(`/purchase-orders/${q.id}`)
    // Delivered but still a draft invoice: number and date stay editable.
    await expect(page.getByRole("button", { name: "Ubah Detail" })).toBeVisible()

    await api("PATCH", `/invoices/${invoice.id}/status`, { status: "sent" })
    await page.reload()
    // PO-04: once filed, nothing on the PO file card can change it.
    await expect(page.getByRole("heading", { name: `Purchase Order ${po.poNumber}` })).toBeVisible()
    await expect(page.getByRole("button", { name: "Ubah Detail" })).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Unggah Berkas" })).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Ganti Berkas" })).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Unduh Berkas" })).toBeVisible()
  })
})

test.describe("purchase order list", () => {
  test("the Dibatalkan filter keeps only the cancelled PO", async ({ page, seed }) => {
    const { client, po } = await acceptedPo(seed)
    const other = await acceptedPo(seed, { client })
    await seed.setPoStatus(other.po.id, "CANCELLED", "Pesanan ganda")

    await page.goto("/purchase-orders")
    await page.getByPlaceholder("Cari purchase order, klien, atau nomor...").fill(seed.prefix)
    const rows = page.getByRole("row", { name: new RegExp(client.name) })
    await expect(rows).toHaveCount(2)
    await page.getByRole("button", { name: "Filter", exact: true }).click()
    const filter = page.getByRole("dialog", { name: "Filter Purchase Order" })
    await filter.getByRole("button", { name: "Dibatalkan" }).click()
    await filter.getByRole("button", { name: "Terapkan" }).click()
    await expect(rows).toHaveCount(1)
    await expect(rows).toContainText("Dibatalkan")
    await expect(rows.getByRole("link", { name: /^PO-/ })).toHaveAttribute(
      "href",
      `/purchase-orders/${other.q.id}`,
    )
    expect(po.id).not.toBe(other.po.id)
  })
})
