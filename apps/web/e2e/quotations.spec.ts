import type { Locator, Page } from "@playwright/test"
import { wibDay } from "./support/finance"
import {
  api,
  deactivate,
  idFrom,
  insertUnreachableContact,
  rupiah,
  setQuotationLegacyNo,
} from "./support/sales"
import { expect, test } from "./support/seed"
import { xlsx } from "./support/xlsx"

// Quotation flows through the UI.
//
// The wizard, the server-driven status machine, Buat Revisi and the PO an
// acceptance creates.

type Request = { requestText: string; matchStatus: string }

const ROMAN_MONTHS = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"]

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
    await page.getByRole("option", { name: `${item.impaCode} - ${item.name}` }).click()
    await product.getByLabel("Kode IMPA/Nama Produk *", { exact: true }).fill(item.name)
    await page.getByRole("option", { name: `${item.impaCode} - ${item.name}` }).click()
    await expect(product.getByRole("combobox", { name: "Satuan *" })).toHaveText(/PCS/)
    await product.getByLabel("Jumlah Produk *").fill("4")
    await product.getByLabel("Nama Vendor *").click()
    await page.getByRole("option", { name: new RegExp(vendor.name) }).click()
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
    await page
      .getByLabel("Alamat Lengkap (Opsional)")
      .fill("Jl. Pelabuhan Raya No. 12, Tanjung Priok")
    await page.getByLabel("Waktu Pengiriman (Hari) *").fill("7")
    await cost.fill("250000")
    await page.getByRole("button", { name: "Lanjut" }).click()

    const create = page.getByRole("button", { name: "Buat Penawaran" })
    await expect(create).toBeDisabled()
    await page.getByLabel("JATUH TEMPO PEMBAYARAN (HARI) *").fill("30")
    await page.getByLabel("BERLAKU SAMPAI (HARI) *").fill("14")
    // The client's own RFQ number, never our client number.
    const ref = `RFQ-${seed.prefix}`
    await page.getByLabel("No. Referensi Klien").fill(ref)
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
    await expect(page.getByText(ref, { exact: true })).toBeVisible()
    const breakdown = costBreakdown(page)
    await expect(amountAfter(breakdown, "Grand Total")).toHaveText(rupiah(wizardTotal))
    // Q-10: the detail profit is taken after the discount, like the wizard.
    await expect(amountAfter(breakdown, "Total Estimasi Profit")).toHaveText(rupiah(140_000))
  })

  test("a client added inside the wizard is the one selected", async ({ page, seed }) => {
    const name = seed.name("Klien Wizard")
    await page.goto("/quotations/add")
    const crumbs = page.getByRole("navigation", { name: "Breadcrumb" })
    await expect(crumbs.locator('[aria-current="page"]')).toHaveText("Tambah Quotation")
    await expect(crumbs.locator('[aria-hidden="true"]')).toHaveCount(1)
    await page.getByRole("button", { name: "Tambah Klien Baru" }).click()
    const modal = page.getByRole("dialog", { name: "Tambah Klien" })
    await modal.getByLabel("Nama Perusahaan *").fill(name)
    await modal.getByLabel("Alamat (Opsional)").fill("Jl. Gatot Subroto Kav. 10, Jakarta Selatan")
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

  test("the unsearched client picker offers only active clients", async ({ page, seed }) => {
    // Sorts before every letter, so it lands on the picker's first page
    // whenever it is among the first 50 clients.
    const dropped = await seed.client({ name: `000 ${seed.prefix} Nonaktif` })
    await deactivate("client", dropped.id)
    // Read before the page loads, so a client another test deactivates
    // later is not blamed on the picker.
    const clients = await api<{ name: string; isActive: boolean }[]>("GET", "/clients?limit=200")
    const inactive = clients.filter((c) => !c.isActive).map((c) => c.name)
    const listed = page.waitForResponse(
      (r) => new URL(r.url()).pathname.endsWith("/clients") && r.request().method() === "GET",
    )
    await page.goto("/quotations/add")
    await listed
    const options = page.locator("main button[aria-pressed]")
    await expect(options.first()).toBeVisible()
    const shown = await options.allTextContents()
    expect(shown.filter((text) => inactive.some((name) => text.includes(`${name} -`)))).toEqual([])
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
    await page.getByRole("option", { name: `${item.impaCode} - ${item.name}` }).click()
    await product.getByRole("button", { name: "Salin ke Offer" }).click()
    await expect(product.getByLabel("Kode IMPA/Nama Produk *", { exact: true })).toHaveValue(
      `${item.impaCode} - ${item.name}`,
    )
    // The copied offer is the same catalog item, so its linked vendor and
    // default unit apply exactly as when the offer is picked directly.
    await expect(product.getByRole("combobox", { name: "Satuan *" })).toHaveText(/PCS/)
    await product.getByLabel("Jumlah Produk *").fill("2")
    await product.getByLabel("Nama Vendor *").click()
    await page.getByRole("option", { name: new RegExp(vendor.name) }).click()
    await expect(product.getByLabel("Harga Beli Satuan *")).toHaveValue("75000")
  })

  test("Salin ke Offer on typed text finds the item and its recommendation", async ({
    page,
    seed,
  }) => {
    const client = await seed.client()
    const vendor = await seed.vendor()
    const item = await seed.item({ vendor, cost: 82_000 })

    await page.goto("/quotations/add")
    await page.getByLabel("Cari klien").fill(seed.prefix)
    await page.getByRole("button", { name: new RegExp(client.name) }).click()
    await page.getByRole("button", { name: "Lanjut" }).click()
    await page.getByRole("button", { name: "Tambah Produk" }).click()

    const product = page.getByRole("dialog", { name: "Tambah Produk ke Quotation" })
    // Typed as the client wrote it, not picked from the list.
    const request = product.getByLabel("Kode IMPA/Nama Produk Request *")
    await request.fill(`${item.impaCode} - nama dari klien`)
    await request.press("Escape")
    await product.getByRole("button", { name: "Salin ke Offer" }).click()
    await expect(product.getByText("Memakai produk katalog yang sama.")).toBeVisible()
    await expect(product.getByLabel("Kode IMPA/Nama Produk *", { exact: true })).toHaveValue(
      `${item.impaCode} - ${item.name}`,
    )
    // Like an Excel row: the recommendation fills the vendor and harga beli.
    await expect(product.getByLabel("Nama Vendor *")).toHaveValue(vendor.name)
    await expect(product.getByLabel("Harga Beli Satuan *")).toHaveValue("82000")
  })

  test("Salin ke Offer adds a product the catalog does not have", async ({ page, seed }) => {
    const client = await seed.client()
    const name = seed.name("Produk Baru Dari Request")

    await page.goto("/quotations/add")
    await page.getByLabel("Cari klien").fill(seed.prefix)
    await page.getByRole("button", { name: new RegExp(client.name) }).click()
    await page.getByRole("button", { name: "Lanjut" }).click()
    await page.getByRole("button", { name: "Tambah Produk" }).click()

    const product = page.getByRole("dialog", { name: "Tambah Produk ke Quotation" })
    const request = product.getByLabel("Kode IMPA/Nama Produk Request *")
    await request.fill(name)
    await request.press("Escape")
    await product.getByRole("button", { name: "Salin ke Offer" }).click()
    await expect(product.getByText("Produk baru ditambahkan ke katalog.")).toBeVisible()
    await expect(product.getByLabel("Kode IMPA/Nama Produk *", { exact: true })).toHaveValue(name)
    expect(await seed.adopt("item", name)).toBeGreaterThan(0)
  })

  test("the detail shows request and offer side by side, a different offer marked", async ({
    page,
    seed,
  }) => {
    const client = await seed.client()
    const same = await seed.item()
    const other = await seed.item()
    const asked = `${seed.prefix} permintaan lain`
    const q = await seed.quotation({
      client,
      lines: [
        { item: same, qty: 1, price: 25_000 },
        { item: other, requested: asked, qty: 1, price: 30_000 },
      ],
    })

    await page.goto(`/quotations/${q.id}`)
    const table = page.getByRole("table")
    await expect(table.getByRole("columnheader", { name: "Permintaan Klien" })).toBeVisible()
    await expect(table.getByRole("columnheader", { name: "Penawaran" })).toBeVisible()
    const plain = table.getByRole("row", { name: new RegExp(same.name) })
    const marked = table.getByRole("row", { name: new RegExp(asked) })
    await expect(marked).toContainText(other.name)
    // Only the different offer cell carries the orange fill.
    await expect(marked.locator("td").nth(1)).toHaveClass(/245,158,11/)
    await expect(plain.locator("td").nth(1)).not.toHaveClass(/245,158,11/)
  })

  test("a failed catalog search stays in the dialog and keeps the lines", async ({
    page,
    seed,
  }) => {
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
    await page.getByRole("option", { name: `${item.impaCode} - ${item.name}` }).click()
    await product.getByRole("button", { name: "Salin ke Offer" }).click()
    await product.getByLabel("Jumlah Produk *").fill("2")
    await product.getByRole("button", { name: "Simpan Data" }).click()
    await expect(product).toBeHidden()
    await expect(page.getByRole("button", { name: /^Hapus produk \d+$/ })).toHaveCount(1)
    await expect(page.getByText(item.name, { exact: true }).first()).toBeVisible()

    // The search and its one retry fail.
    await page.route("**/api/v1/items/search-advanced**", (route) =>
      route.fulfill({ status: 502, contentType: "application/problem+json", body: "{}" }),
    )
    await page.getByRole("button", { name: "Tambah Produk" }).click()
    await product.getByLabel("Kode IMPA/Nama Produk Request *").fill(`${item.name} lain`)
    await expect(
      page.getByRole("alert").filter({ hasText: "Gagal memuat katalog produk." }),
    ).toBeVisible()
    await page.unroute("**/api/v1/items/search-advanced**")
    await page.getByRole("button", { name: "Coba Lagi" }).click()
    await expect(page.getByText("Gagal memuat katalog produk.")).toHaveCount(0)
    // Escape closes the open suggestions, not the dialog.
    await product.getByLabel("Kode IMPA/Nama Produk Request *").press("Escape")
    await expect(product).toBeVisible()
    await product.getByRole("button", { name: "Batal" }).click()

    await expect(page.getByRole("heading", { name: "Pilih Produk" })).toBeVisible()
    await expect(page.getByRole("button", { name: /^Hapus produk \d+$/ })).toHaveCount(1)
    await expect(page.getByText(item.name, { exact: true }).first()).toBeVisible()
  })

  test("a failed client search stays on step 1 and keeps the lines", async ({ page, seed }) => {
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
    await page.getByRole("option", { name: `${item.impaCode} - ${item.name}` }).click()
    await product.getByRole("button", { name: "Salin ke Offer" }).click()
    await product.getByLabel("Jumlah Produk *").fill("2")
    await product.getByRole("button", { name: "Simpan Data" }).click()
    await expect(product).toBeHidden()
    await expect(page.getByRole("button", { name: /^Hapus produk \d+$/ })).toHaveCount(1)
    await expect(page.getByText(item.name, { exact: true }).first()).toBeVisible()

    // The search and its one retry fail.
    await page.route("**/api/v1/clients/search**", (route) =>
      route.fulfill({ status: 502, contentType: "application/problem+json", body: "{}" }),
    )
    await page.getByRole("button", { name: "Kembali" }).click()
    await page.getByLabel("Cari klien").fill(`${seed.prefix} lain`)
    await expect(
      page.getByRole("alert").filter({ hasText: "Gagal memuat daftar klien." }),
    ).toBeVisible()
    await page.unroute("**/api/v1/clients/search**")
    await page.getByRole("button", { name: "Coba Lagi" }).click()
    await expect(page.getByText("Gagal memuat daftar klien.")).toHaveCount(0)

    await page.getByLabel("Cari klien").fill("")
    await page.getByRole("button", { name: "Lanjut" }).click()
    await expect(page.getByRole("heading", { name: "Pilih Produk" })).toBeVisible()
    await expect(page.getByRole("button", { name: /^Hapus produk \d+$/ })).toHaveCount(1)
    await expect(page.getByText(item.name, { exact: true }).first()).toBeVisible()
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
      page.getByText(
        "2 produk diimpor (1 cocok dengan katalog, 1 produk baru). 0 terisi otomatis. 2 perlu vendor dan harga sebelum dikirim.",
      ),
    ).toBeVisible()
    await seed.adopt("item", fresh)

    const main = page.locator("main")
    // The offer prints its code beside the name.
    await expect(main.getByText(item.impaCode, { exact: true }).first()).toBeVisible()
    await expect(main).toContainText(fresh)
    // MD-01: the deactivated cheaper vendor never supplies the price.
    await expect(main).toContainText(active.name)
    await expect(main).not.toContainText(cheap.name)
    await expect(main).toContainText("Rp 90.000")
  })

  // The API parses the workbook: the merged banner and DECK STORES rows
  // are not products, and the two-row header still maps every column.
  test("an Excel RFQ with merged rows imports only its products", async ({ page, seed }) => {
    const client = await seed.client()
    const item = await seed.item()
    const fresh = `Qzvx ${seed.prefix.slice(3).toLowerCase()} xlsq`
    const file = xlsx({
      rows: [
        ["PERMINTAAN KAPAL MV SINAR BAHARI"],
        ["No", "Produk", null, "Jumlah", "Satuan"],
        [null, "Kode IMPA", "Nama"],
        ["DECK STORES"],
        [1, item.impaCode, item.name, 3, "PCS"],
        [2, null, fresh, 2, "PCS"],
      ],
      merges: ["A1:E1", "B2:C2", "A2:A3", "D2:D3", "E2:E3", "A4:E4"],
    })

    await page.goto("/quotations/add")
    await page.getByLabel("Cari klien").fill(seed.prefix)
    await page.getByRole("button", { name: new RegExp(client.name) }).click()
    await page.getByRole("button", { name: "Lanjut" }).click()
    const input = page.locator('input[type="file"][accept=".csv,.xlsx"]')
    await input.setInputFiles({
      name: "permintaan.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: file,
    })
    await expect(
      page.getByText(
        "2 produk diimpor (1 cocok dengan katalog, 1 produk baru). 0 terisi otomatis. 2 perlu vendor dan harga sebelum dikirim.",
      ),
    ).toBeVisible()
    await seed.adopt("item", fresh)
    const main = page.locator("main")
    // The offer prints its code beside the name.
    await expect(main.getByText(item.impaCode, { exact: true }).first()).toBeVisible()
    await expect(main).toContainText(fresh)
    await expect(main).not.toContainText("DECK STORES")

    // A file the API cannot read shows its Indonesian reason.
    await input.setInputFiles({
      name: "rusak.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: Buffer.from("bukan workbook"),
    })
    await expect(page.getByText(/Gagal membaca berkas: Format berkas tidak didukung/)).toBeVisible()

    // More products than one match call takes is refused before matching.
    await input.setInputFiles({
      name: "besar.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(`Nama,Jumlah\n${"Baut,2\n".repeat(501)}`),
    })
    await expect(
      page.getByText(
        "Gagal membaca berkas: Berkas berisi 501 baris produk, padahal paling banyak 500 per unggahan. Bagi berkas lalu unggah ulang.",
      ),
    ).toBeVisible()
  })

  // Import fills lines; drafts save unfinished.
  // A matched line starts from this client's last deal: its vendor at the
  // vendor's current harga beli, and the harga jual that was sent. A new
  // product starts empty, and the draft still saves; it only has to be
  // complete, or marked Tidak Ditawarkan, before it is sent.
  test("an Excel RFQ fills lines from the last deal and sends once complete", async ({
    page,
    seed,
  }) => {
    const client = await seed.client()
    const vendor = await seed.vendor()
    const item = await seed.item({ vendor, cost: 100_000 })
    const deal = await seed.quotation({ client, lines: [{ item, qty: 1, price: 150_000 }] })
    await seed.send(deal.id)
    const fresh = `Qzvx ${seed.prefix.slice(3).toLowerCase()} baru`
    const file = xlsx({
      rows: [
        ["No", "Kode IMPA", "Nama", "Jumlah", "Satuan"],
        [1, item.impaCode, item.name, 3, "PCS"],
        [2, null, fresh, 2, "PC"],
      ],
    })

    await page.goto("/quotations/add")
    await page.getByLabel("Cari klien").fill(seed.prefix)
    await page.getByRole("button", { name: new RegExp(client.name) }).click()
    await page.getByRole("button", { name: "Lanjut" }).click()
    await page.locator('input[type="file"][accept=".csv,.xlsx"]').setInputFiles({
      name: "permintaan.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: file,
    })
    await expect(
      page.getByText(
        "2 produk diimpor (1 cocok dengan katalog, 1 produk baru). 1 terisi otomatis. 1 perlu vendor dan harga sebelum dikirim. 1 produk perlu satuan yang dikenal. Pilih satuannya lewat tombol Ubah.",
      ),
    ).toBeVisible()
    await seed.adopt("item", fresh)

    const main = page.locator("main")
    await expect(main).toContainText(vendor.name)
    await expect(main).toContainText("Rp 100.000")
    await expect(main).toContainText("Rp 150.000")
    await expect(main).toContainText("Belum lengkap: vendor, harga beli, harga jual")
    await expect(
      page.getByRole("alert").filter({ hasText: 'Satuan "PC" tidak dikenal.' }),
    ).toBeVisible()

    // A known unit is the one thing a draft cannot do without.
    await page.getByRole("button", { name: "Ubah produk 2" }).click()
    const product = page.getByRole("dialog", { name: "Ubah Produk Quotation" })
    await product.getByRole("combobox", { name: "Satuan *" }).click()
    await page.getByRole("option", { name: /^PCS/ }).click()
    await product.getByRole("button", { name: "Simpan Perubahan" }).click()
    await expect(product).toBeHidden()
    await expect(page.getByText('Satuan "PC" tidak dikenal.')).toHaveCount(0)
    await page.getByRole("button", { name: "Tidak Ditawarkan produk 2" }).click()
    await expect(main).toContainText("Tidak ditawarkan ke klien.")

    await page.getByRole("button", { name: "Lanjut" }).click()
    await page.getByLabel("Waktu Pengiriman (Hari) *").fill("7")
    await page.getByRole("button", { name: "Lanjut" }).click()
    await page.getByLabel("JATUH TEMPO PEMBAYARAN (HARI) *").fill("30")
    await page.getByLabel("BERLAKU SAMPAI (HARI) *").fill("14")
    await page.getByRole("button", { name: "Buat Penawaran" }).click()
    await expect(page).toHaveURL(/\/quotations$/)
    await page.getByPlaceholder("Cari penawaran, klien, atau nomor...").fill(seed.prefix)
    const rows = page.getByRole("row", { name: new RegExp(client.name) })
    await expect(rows).toHaveCount(2)
    const created = await seed.adoptNewestQuotation(client)

    await page.goto(`/quotations/${created}`)
    await expect(page.getByText("Tidak Ditawarkan", { exact: true })).toBeVisible()
    const menu = await openStatusMenu(page, "Draf")
    await menu.getByRole("menuitem", { name: "Dikirim" }).click()
    await page
      .getByRole("dialog", { name: "Ubah Status ke Dikirim" })
      .getByRole("button", { name: "Simpan Status" })
      .click()
    await expectStatus(page, "Dikirim")
    const sent = await seed.getQuotation(created)
    const [offered, notOffered] = sent.items.filter((l) => l.itemType === "product")
    expect([offered.vendorName, offered.costPrice, offered.sellingPrice]).toEqual([
      vendor.name,
      "100000.00",
      "150000.00",
    ])
    expect([notOffered.isAvailable, notOffered.sellingPrice]).toEqual([false, "0.00"])
  })

  // An unfinished line blocks sending.
  test("a draft with an unpriced line is refused at Dikirim", async ({ page, seed }) => {
    const client = await seed.client()
    const q = await seed.quotation({
      client,
      lines: [{ freeText: seed.name("Permintaan bebas"), qty: 1, price: 0 }],
    })
    await page.goto(`/quotations/${q.id}`)
    const menu = await openStatusMenu(page, "Draf")
    await menu.getByRole("menuitem", { name: "Dikirim" }).click()
    await page
      .getByRole("dialog", { name: "Ubah Status ke Dikirim" })
      .getByRole("button", { name: "Simpan Status" })
      .click()
    await expect(
      page.getByText(
        "1 baris produk belum lengkap. Isi produk, satuan, vendor, harga beli, dan harga jual sebelum quotation dikirim.",
      ),
    ).toBeVisible()
    await page
      .getByRole("dialog", { name: "Ubah Status ke Dikirim" })
      .getByRole("button", { name: "Batal" })
      .click()
    await expectStatus(page, "Draf")
    // The page says what blocks Dikirim and opens the editor to fix it.
    const notice = page.getByRole("status").filter({ hasText: "1 produk belum lengkap." })
    await expect(notice).toBeVisible()
    await notice.getByRole("button", { name: "Lengkapi Sekarang" }).click()
    await expect(page).toHaveURL(new RegExp(`/quotations/${q.id}/edit$`))
  })

  // Picking a product fills it in.
  // Any active vendor is searchable, not only the product's own.
  test("a product picked by hand starts from its recommendation", async ({ page, seed }) => {
    const client = await seed.client()
    const vendor = await seed.vendor()
    const other = await seed.vendor({ label: "Vendor Lain" })
    const item = await seed.item({ vendor, cost: 80_000 })
    const deal = await seed.quotation({ client, lines: [{ item, qty: 1, price: 125_000 }] })
    await seed.send(deal.id)

    await page.goto("/quotations/add")
    await page.getByLabel("Cari klien").fill(seed.prefix)
    await page.getByRole("button", { name: new RegExp(client.name) }).click()
    await page.getByRole("button", { name: "Lanjut" }).click()
    await page.getByRole("button", { name: "Tambah Produk" }).click()
    const product = page.getByRole("dialog", { name: "Tambah Produk ke Quotation" })
    await product.getByLabel("Kode IMPA/Nama Produk Request *").fill(item.name)
    await page.getByRole("option", { name: `${item.impaCode} - ${item.name}` }).click()
    await product.getByLabel("Kode IMPA/Nama Produk *", { exact: true }).fill(item.name)
    await page.getByRole("option", { name: `${item.impaCode} - ${item.name}` }).click()
    await expect(product.getByLabel("Nama Vendor *")).toHaveValue(vendor.name)
    await expect(product.getByLabel("Harga Beli Satuan *")).toHaveValue("80000")
    await expect(product.getByLabel("Harga Jual Satuan *")).toHaveValue("125000")

    await product.getByLabel("Jumlah Produk *").fill("2")
    await product.getByLabel("Nama Vendor *").fill(other.name)
    await expect(page.getByRole("option", { name: new RegExp(other.name) })).toBeVisible()
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

    await row.getByRole("button", { name: "Hapus" }).click()
    await page
      .getByRole("dialog", { name: "Hapus permintaan ini?" })
      .getByRole("button", { name: "Hapus Permintaan" })
      .click()
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
      clientRefNo: "RFQ-LAMA",
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
    // The stored client reference is the header's to correct.
    const ref = page.getByLabel("No. Referensi Klien")
    await expect(ref).toHaveValue("RFQ-LAMA")
    await ref.fill("RFQ-BARU")
    await page.getByRole("button", { name: "Simpan" }).click()
    await expect(page).toHaveURL(new RegExp(`/quotations/${q.id}$`))
    // Q-11: saving the editor keeps the fields it does not show.
    await expect
      .poll(async () => {
        const saved = await seed.getQuotation(q.id)
        return [saved.vesselName, saved.notes, saved.clientRefNo]
      })
      .toEqual(["MV Sinar Bahari", "Kirim sebelum akhir bulan", "RFQ-BARU"])

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

  test("the summary and the detail show the picked contact's own channels", async ({
    page,
    seed,
  }) => {
    const client = await seed.client()
    const vendor = await seed.vendor()
    const item = await seed.item({ vendor, cost: 100_000 })
    const second = `${seed.prefix} Narahubung Kedua`
    await seed.contact(client, second)
    const [picked] = (
      await api<{ name: string; email: string; phone: string }[]>(
        "GET",
        `/clients/${client.id}/contacts`,
      )
    ).filter((c) => c.name === second)

    await page.goto("/quotations/add")
    await page.getByLabel("Cari klien").fill(seed.prefix)
    // The row names the client only, never its first contact.
    const row = page.getByRole("button", { name: new RegExp(client.name) })
    await expect(row).not.toContainText("Narahubung")
    await row.click()
    await page.getByRole("button", { name: new RegExp(`^${second}`) }).click()
    await page.getByRole("button", { name: "Lanjut" }).click()

    await page.getByRole("button", { name: "Tambah Produk" }).click()
    const product = page.getByRole("dialog", { name: "Tambah Produk ke Quotation" })
    await product.getByLabel("Kode IMPA/Nama Produk Request *").fill(item.name)
    await page.getByRole("option", { name: `${item.impaCode} - ${item.name}` }).click()
    await product.getByRole("button", { name: "Salin ke Offer" }).click()
    await product.getByLabel("Jumlah Produk *").fill("1")
    await product.getByRole("button", { name: "Simpan Data" }).click()
    await expect(product).toBeHidden()
    await page.getByRole("button", { name: "Lanjut" }).click()
    await page.getByRole("button", { name: "Lanjut" }).click()

    const card = page.getByRole("heading", { name: "Ringkasan Klien" }).locator("xpath=..")
    await expect(card).toContainText(second)
    await expect(card).toContainText(picked.email)
    await expect(card).toContainText(picked.phone)
    await expect(card).not.toContainText(client.contactEmail ?? "-")
    await page.getByLabel("JATUH TEMPO PEMBAYARAN (HARI) *").fill("30")
    await page.getByLabel("BERLAKU SAMPAI (HARI) *").fill("14")
    await page.getByRole("button", { name: "Buat Penawaran" }).click()

    await expect(page).toHaveURL(/\/quotations$/)
    await page.getByPlaceholder("Cari penawaran, klien, atau nomor...").fill(seed.prefix)
    const link = page
      .getByRole("row", { name: new RegExp(client.name) })
      .getByRole("link")
      .first()
    seed.track("quotation", idFrom(await link.getAttribute("href")))
    await link.click()
    const detail = page.getByRole("heading", { name: "Ringkasan Klien" }).locator("xpath=..")
    await expect(detail).toContainText(second)
    await expect(detail).toContainText(picked.email)
    await expect(detail).not.toContainText(client.contactEmail ?? "-")
  })

  test("a picked contact with no email or phone is completed on step 1", async ({ page, seed }) => {
    const client = await seed.client()
    const name = `${seed.prefix} Tanpa Kontak`
    const id = insertUnreachableContact(client.id, name)

    await page.goto("/quotations/add")
    await page.getByLabel("Cari klien").fill(seed.prefix)
    await page.getByRole("button", { name: new RegExp(client.name) }).click()
    const contact = page.getByRole("button", { name: new RegExp(`^${name}`) })
    await expect(contact).toContainText("Belum ada email atau nomor HP")
    await contact.click()
    await expect(page.getByText(`${name} belum punya email atau nomor HP.`)).toBeVisible()
    await expect(page.getByRole("button", { name: "Lanjut" })).toBeDisabled()

    await page.getByLabel("Nomor HP").fill("81355500099")
    await page.getByRole("button", { name: "Simpan Narahubung" }).click()
    await expect(contact).toContainText("81355500099")
    await expect(page.getByRole("button", { name: "Lanjut" })).toBeEnabled()
    const [saved] = (
      await api<{ id: number; phone?: string }[]>("GET", `/clients/${client.id}/contacts`)
    ).filter((c) => c.id === id)
    expect(saved.phone).toBe("81355500099")
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

  test("a move picked from the menu hands focus back to the badge", async ({ page, seed }) => {
    const client = await seed.client()
    const item = await seed.item()
    const q = await seed.quotation({ client, lines: [{ item, qty: 1, price: 50_000 }] })
    await seed.send(q.id)
    await page.goto(`/quotations/${q.id}`)
    const badge = page.getByRole("button", { name: "Status Dikirim, ubah status" })

    // Pointer pick, then Batal
    const menu = await openStatusMenu(page, "Dikirim")
    await menu.getByRole("menuitem", { name: "Ditolak" }).click()
    const dialog = page.getByRole("dialog", { name: "Ubah Status ke Ditolak" })
    await dialog.getByRole("button", { name: "Batal" }).click()
    await expect(dialog).toBeHidden()
    await expect(badge).toBeFocused()

    // Keyboard pick, then Escape
    await page.keyboard.press("ArrowDown")
    // Enter only once the open menu highlights its first move.
    await expect(page.getByRole("menuitem", { name: "Disetujui" })).toBeFocused()
    await page.keyboard.press("Enter")
    await expect(page.getByRole("dialog", { name: "Ubah Status ke Disetujui" })).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(page.getByRole("dialog")).toHaveCount(0)
    await expect(badge).toBeFocused()
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
    await expect(page.getByRole("heading", { name: "Ubah Quotation" })).toBeVisible()
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

  test.describe("as the operational head", () => {
    test.use({ session: "operational" })

    // The owner moves a quotation; the head's last step is the PDF.
    test("a sent quotation downloads but offers no move", async ({ page, seed }) => {
      const client = await seed.client()
      const item = await seed.item()
      const q = await seed.quotation({ client, lines: [{ item, qty: 2, price: 75_000 }] })
      await seed.send(q.id)
      await page.goto(`/quotations/${q.id}`)
      await expect(page.getByRole("button", { name: "Unduh PDF" })).toBeVisible()
      await expect(page.getByRole("button", { name: "Status Dikirim, ubah status" })).toHaveCount(0)
      await expect(page.getByRole("button", { name: "Buat Revisi" })).toHaveCount(0)
    })
  })

  test.describe("as superadmin", () => {
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
      await expect(page.getByText(`Tidak ada hasil untuk "${seed.prefix}".`)).toBeVisible()

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
  // Imports keep their old number.
  test("a re-imported quotation is found and shown by its old number", async ({ page, seed }) => {
    const client = await seed.client()
    const item = await seed.item()
    const q = await seed.quotation({ client, lines: [{ item, qty: 1, price: 30_000 }] })
    const legacy = `Q-26${seed.prefix}/GNS/X/2025`
    setQuotationLegacyNo(q.id, legacy)

    await page.goto("/quotations")
    await page.getByPlaceholder("Cari penawaran, klien, atau nomor...").fill(legacy)
    await page.getByRole("link", { name: q.quotationNo }).click()
    await expect(page.getByText(`No. lama: ${legacy}`)).toBeVisible()
  })

  // Numbers carry their period.
  test("a search by month and year finds this month's numbers", async ({ page, seed }) => {
    const client = await seed.client()
    const item = await seed.item()
    const q = await seed.quotation({ client, lines: [{ item, qty: 1, price: 30_000 }] })
    const day = wibDay()
    const year = day.slice(0, 4)
    const roman = ROMAN_MONTHS[Number(day.slice(5, 7)) - 1]
    expect(q.quotationNo).toMatch(new RegExp(`^Q-\\d{5,}/GNS/${roman}/${year}$`))

    await page.goto("/quotations")
    await page.getByRole("button", { name: /^\d+ Baris$/ }).click()
    await page.getByRole("menuitemradio", { name: "15 Baris", exact: true }).click()
    await page
      .getByPlaceholder("Cari penawaran, klien, atau nomor...")
      .fill(` ${day.slice(5, 7)}/${year} `)
    // Parallel workers fill this month past one page, so the server answers
    // whether the period search holds this quotation; the page shows its rows.
    const hits = await api<{ id: number }[]>(
      "GET",
      `/quotations?q=${encodeURIComponent(`${day.slice(5, 7)}/${year}`)}&limit=200`,
    )
    expect(hits.map((h) => h.id)).toContain(q.id)
    await expect(page.getByRole("link", { name: /^Q-\d{5,}\// }).first()).toBeVisible()
    // Only that month: I/2026 never lists II/2026.
    for (const no of await page.getByRole("link", { name: /^Q-\d{5,}\// }).allTextContents()) {
      expect(no).toContain(`/GNS/${roman}/${year}`)
    }
  })

  // No match is not an empty list.
  test("a search with no match names the term, not Belum ada", async ({ page }) => {
    await page.goto("/quotations")
    await page.getByPlaceholder("Cari penawaran, klien, atau nomor...").fill("zzz-tidak-ada-zzz")
    await expect(page.getByText('Tidak ada hasil untuk "zzz-tidak-ada-zzz".')).toBeVisible()
    await expect(page.getByText("Belum ada Quotation.")).toHaveCount(0)
  })

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

    await page.getByRole("button", { name: "Filter", exact: true }).click()
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

  // Narrower result moves the reader.
  test("removing a chip past the last page lands on the new last page", async ({ page, seed }) => {
    const client = await seed.client()
    const item = await seed.item()
    const lines = [{ item, qty: 1, price: 30_000 }]
    for (let i = 0; i < 4; i++) await seed.quotation({ client, lines })
    for (let i = 0; i < 2; i++) {
      const q = await seed.quotation({ client, lines })
      await seed.setQuotationStatus(q.id, "cancelled", "Klien tidak jadi memesan")
    }

    await page.goto("/quotations")
    await page.getByPlaceholder("Cari penawaran, klien, atau nomor...").fill(seed.prefix)
    const rows = page.getByRole("row", { name: new RegExp(client.name) })
    await expect(rows).toHaveCount(6)
    await page.getByRole("button", { name: "Filter", exact: true }).click()
    const filter = page.getByRole("dialog", { name: "Filter Quotation" })
    const statuses = filter.getByRole("group", { name: "Status Quotation" })
    await statuses.getByRole("button", { name: "Draf" }).click()
    await statuses.getByRole("button", { name: "Dibatalkan" }).click()
    await filter.getByRole("button", { name: "Terapkan" }).click()

    await page.getByRole("button", { name: /^\d+ Baris$/ }).click()
    await page.getByRole("menuitemradio", { name: "5 Baris", exact: true }).click()
    await page.getByRole("button", { name: "2", exact: true }).click()
    await expect(rows).toHaveCount(1)

    await page.getByRole("button", { name: "Hapus filter Status: Draf" }).click()
    await expect(rows).toHaveCount(2)
    await expect(page.getByText("Menampilkan 1-2 dari 2 Quotation")).toBeVisible()
    await expect(page.getByRole("button", { name: "1", exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    )
  })
})

test.describe("quotation PPN", () => {
  test("a draft switched to Tanpa PPN totals without tax", async ({ page, seed }) => {
    const client = await seed.client()
    const item = await seed.item()
    const q = await seed.quotation({ client, lines: [{ item, qty: 1, price: 10_000 }] })

    await page.goto(`/quotations/${q.id}/edit`)
    await page.getByRole("button", { name: "Lanjut" }).click()
    const ppn = page.getByRole("switch", { name: "Kenakan PPN 12%" })
    await expect(ppn).toHaveAttribute("aria-checked", "true")
    await expect(page.getByText("PPN 12%", { exact: true })).toBeVisible()
    await ppn.click()
    await expect(ppn).toHaveAttribute("aria-checked", "false")
    await expect(page.getByText("Tanpa PPN", { exact: true })).toBeVisible()
    await expect(page.getByText("DPP Nilai Lain", { exact: true })).toHaveCount(0)
    await expect
      .poll(async () => {
        const d = await api<{ ppnEnabled: boolean; ppnAmount: string; grandTotal: string }>(
          "GET",
          `/quotations/${q.id}`,
        )
        return [d.ppnEnabled, Number(d.ppnAmount), Number(d.grandTotal)]
      })
      .toEqual([false, 0, 10_000])

    await page.goto(`/quotations/${q.id}`)
    const costs = costBreakdown(page)
    await expect(amountAfter(costs, "PPN")).toHaveText("Tanpa PPN")
    await expect(costs.getByText("PPN 12%", { exact: true })).toHaveCount(0)
    await expect(amountAfter(costs, "Grand Total")).toHaveText(rupiah(10_000))
  })
})
