import { api } from "./support/sales"
import { expect, test } from "./support/seed"

// What each input role sees.
//
// Operational input works without harga jual, finance input without harga
// beli, and the finance head reads operational documents without editing
// them. The API leaves the hidden figures out, so the pages show no column
// for them rather than a zero.

test.describe("as operational input", () => {
  test.use({ session: "operational_input" })

  test("a quotation shows no selling figure and no download", async ({ page, seed }) => {
    const client = await seed.client()
    const vendor = await seed.vendor()
    const item = await seed.item({ vendor, cost: 60_000 })
    const q = await seed.quotation({
      client,
      lines: [{ item, qty: 2, price: 100_000, cost: 60_000 }],
    })

    await page.goto(`/quotations/${q.id}`)
    await expect(page.getByRole("heading", { name: "Detail Produk" })).toBeVisible()
    await expect(page.getByRole("cell", { name: item.name }).first()).toBeVisible()
    await expect(page.getByRole("columnheader", { name: "Harga Jual Satuan" })).toHaveCount(0)
    await expect(page.getByText("Grand Total")).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Unduh PDF" })).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Ubah", exact: true })).toBeVisible()

    await page.goto("/quotations")
    await expect(page.getByRole("columnheader", { name: "Total Penawaran" })).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Ekspor Excel" })).toHaveCount(0)
  })

  test("a PO edit changes harga beli only and the catalog follows", async ({ page, seed }) => {
    const client = await seed.client()
    const vendor = await seed.vendor()
    const item = await seed.item({ vendor, cost: 60_000 })
    const q = await seed.quotation({
      client,
      lines: [{ item, qty: 2, price: 100_000, cost: 60_000 }],
    })
    const po = await seed.accept(q.id)

    await page.goto(`/purchase-orders/${q.id}`)
    await expect(page.getByRole("button", { name: "Ubah", exact: true })).toBeVisible()
    await expect(page.getByRole("columnheader", { name: "Harga Jual Satuan" })).toHaveCount(0)

    await page.goto(`/purchase-orders/${q.id}/edit`)
    await expect(page.getByRole("button", { name: "Tambah Produk" })).toHaveCount(0)
    await page.getByRole("button", { name: "Ubah produk 1" }).click()
    const modal = page.getByRole("dialog", { name: "Ubah Produk PO" })
    await expect(modal.getByLabel("Jumlah Produk *")).toBeDisabled()
    await modal.getByLabel("Harga Beli Satuan *").fill("55000")
    await modal.getByRole("button", { name: "Simpan Perubahan" }).click()
    const confirm = page.getByRole("dialog", { name: "Konfirmasi Perubahan Harga" })
    await confirm.getByRole("button", { name: "Ya, Ubah" }).click()
    await expect(modal).toBeHidden()
    await page.getByRole("button", { name: "Lanjut" }).click()
    await page.getByRole("button", { name: "Lanjut" }).click()
    await page.getByRole("button", { name: "Simpan", exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/purchase-orders/${q.id}$`))

    const costs = async () => {
      const lines = await api<{ itemType: string; costPrice?: string; qty: string }[]>(
        "GET",
        `/purchase-orders/${po.id}/items`,
      )
      const links = await api<{ vendorId: number; costPrice?: string }[]>(
        "GET",
        `/items/${item.id}/vendors`,
      )
      const line = lines.find((l) => l.itemType === "product")
      return [line?.costPrice, line?.qty, links.find((l) => l.vendorId === vendor.id)?.costPrice]
    }
    await expect.poll(costs).toEqual(["55000.00", "2.00", "55000.00"])
  })

  test("the product dialog asks for harga beli only", async ({ page, seed }) => {
    const client = await seed.client()
    await page.goto("/quotations/add")
    await page.getByLabel("Cari klien").fill(seed.prefix)
    await page.getByRole("button", { name: new RegExp(client.name) }).click()
    await page.getByRole("button", { name: "Lanjut" }).click()
    await expect(page.getByRole("button", { name: "Tambah Diskon" })).toHaveCount(0)
    await page.getByRole("button", { name: "Tambah Produk" }).click()
    const dialog = page.getByRole("dialog", { name: "Tambah Produk ke Quotation" })
    await expect(dialog.getByLabel("Harga Beli Satuan *")).toBeVisible()
    await expect(dialog.getByLabel("Harga Jual Satuan *")).toHaveCount(0)
    await expect(dialog.getByRole("button", { name: "Riwayat Harga Jual" })).toHaveCount(0)
  })

  // Tidak Ditawarkan stores harga jual 0, so a line a head priced stays on
  // offer for this role, and the refusal names who marks it instead.
  test("a priced line stays on offer and an unpriced one toggles", async ({ page, seed }) => {
    const client = await seed.client()
    const vendor = await seed.vendor()
    const priced = await seed.item({ vendor, cost: 60_000 })
    const unpriced = await seed.item({ vendor, cost: 40_000 })
    const q = await seed.quotation({
      client,
      lines: [
        { item: priced, qty: 2, price: 100_000, cost: 60_000 },
        { item: unpriced, qty: 1, price: 0, cost: 40_000 },
      ],
    })
    const lines = async () =>
      (await seed.getQuotation(q.id)).items
        .filter((it) => it.itemType === "product")
        .map((it) => [it.isAvailable, it.sellingPrice])

    await page.goto(`/quotations/${q.id}/edit`)
    const next = page.getByRole("button", { name: "Lanjut" })
    await expect(next).toBeEnabled()
    await next.click()

    await page.getByRole("button", { name: "Tidak Ditawarkan produk 1" }).click()
    await expect(
      page.getByText(
        "Baris ini sudah diberi harga jual. Minta kepala operasional untuk menandai Tidak Ditawarkan.",
      ),
    ).toBeVisible()
    await expect(page.getByRole("button", { name: "Tidak Ditawarkan produk 1" })).toBeVisible()

    await page.getByRole("button", { name: "Tidak Ditawarkan produk 2" }).click()
    await expect(page.getByRole("button", { name: "Tawarkan produk 2" })).toBeVisible()
    await expect.poll(lines).toEqual([
      [true, "100000.00"],
      [false, "0.00"],
    ])

    await page.getByRole("button", { name: "Tawarkan produk 2" }).click()
    await expect(page.getByRole("button", { name: "Tidak Ditawarkan produk 2" })).toBeVisible()
    await expect.poll(lines).toEqual([
      [true, "100000.00"],
      [true, "0.00"],
    ])
  })
})

test.describe("as finance input", () => {
  test.use({ session: "finance_input" })

  test("a PO shows what is billed but no cost or profit", async ({ page, seed }) => {
    const client = await seed.client()
    const vendor = await seed.vendor()
    const item = await seed.item({ vendor, cost: 60_000 })
    const q = await seed.quotation({
      client,
      lines: [{ item, qty: 2, price: 100_000, cost: 60_000 }],
    })
    await seed.accept(q.id)

    await page.goto(`/purchase-orders/${q.id}`)
    await expect(page.getByRole("columnheader", { name: "Harga Jual Satuan" })).toBeVisible()
    await expect(page.getByRole("columnheader", { name: "Profit (Rp)" })).toHaveCount(0)
    await expect(page.getByText("Total Estimasi Profit")).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Ubah", exact: true })).toHaveCount(0)
  })

  test("a client opens read only", async ({ page, seed }) => {
    const client = await seed.client({ complete: false })
    await page.goto(`/clients/${client.id}`)
    await expect(page.getByLabel(/^Nama Klien/)).toBeDisabled()
    await expect(page.getByLabel("NPWP", { exact: true })).toBeDisabled()
    await expect(page.getByRole("button", { name: "Simpan Perubahan" })).toHaveCount(0)
    await expect(page.getByRole("button", { name: "+ Tambah Narahubung" })).toHaveCount(0)
  })
})

test.describe("as the finance head", () => {
  test.use({ session: "finance" })

  test("a quotation reads in full but is not edited", async ({ page, seed }) => {
    const client = await seed.client()
    const vendor = await seed.vendor()
    const item = await seed.item({ vendor, cost: 60_000 })
    const q = await seed.quotation({
      client,
      lines: [{ item, qty: 2, price: 100_000, cost: 60_000 }],
    })

    await page.goto(`/quotations/${q.id}`)
    await expect(page.getByRole("columnheader", { name: "Harga Jual Satuan" })).toBeVisible()
    await expect(page.getByRole("button", { name: "Unduh PDF" })).toBeVisible()
    await expect(page.getByRole("button", { name: "Ubah", exact: true })).toHaveCount(0)

    await page.goto(`/quotations/${q.id}/edit`)
    await expect(page).toHaveURL(/\/$/)
  })
})
