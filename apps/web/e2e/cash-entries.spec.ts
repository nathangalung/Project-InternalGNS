import { readFile } from "node:fs/promises"
import { expect, test } from "./fixtures"

// Kas Lain.
//
// Finance input records money in and out beyond sales and purchases and
// corrects it; the finance head also deletes and exports. Each test names
// its entries uniquely, so parallel runs never read each other's rows.

function tag(): string {
  return `E2E Kas ${Date.now()}${Math.floor(Math.random() * 1000)}`
}

test.describe("as finance input", () => {
  test.use({ session: "finance_input" })

  test("an entry is added, totalled and corrected", async ({ page }) => {
    const note = tag()
    await page.goto("/cash-entries")
    await expect(page.getByRole("heading", { name: "Kas Lain" })).toBeVisible()
    await expect(page.getByRole("button", { name: "Ekspor Excel" })).toHaveCount(0)

    await page.getByRole("button", { name: "Tambah Catatan" }).click()
    const dialog = page.getByRole("dialog", { name: "Tambah Catatan Kas" })
    await dialog.getByRole("button", { name: "Simpan" }).click()
    await expect(dialog.getByText("Pilih Masuk atau Keluar.")).toBeVisible()
    await expect(dialog.getByText("Kategori wajib diisi.")).toBeVisible()

    await dialog.getByRole("button", { name: "Keluar" }).click()
    await dialog.getByLabel(/^Jumlah/).fill("1.250.000,50")
    await expect(dialog.getByLabel(/^Jumlah/)).toHaveValue("1.250.000,50")
    await dialog.getByLabel(/^Kategori/).fill("Sewa Kantor")
    await dialog.getByLabel(/^Keterangan/).fill(note)
    await dialog.getByRole("button", { name: "Simpan" }).click()
    await expect(dialog).toBeHidden()

    await page.getByPlaceholder("Cari keterangan atau kategori...").fill(note)
    const row = page.getByRole("row").filter({ hasText: note })
    await expect(row).toContainText("Keluar")
    await expect(row).toContainText("Rp1.250.000,50")
    await expect(page.getByText("Total Keluar").locator("..")).toContainText("Rp1.250.000,50")
    await expect(row.getByRole("button", { name: /^Hapus/ })).toHaveCount(0)

    await row.getByRole("button", { name: /^Ubah/ }).click()
    const edit = page.getByRole("dialog", { name: "Ubah Catatan Kas" })
    await expect(edit.getByLabel(/^Jumlah/)).toHaveValue("1.250.000,50")
    await edit.getByLabel(/^Jumlah/).fill("1.300.000")
    await edit.getByRole("button", { name: "Simpan" }).click()
    await expect(edit).toBeHidden()
    await expect(row).toContainText("Rp1.300.000")
  })
})

test.describe("as the finance head", () => {
  test.use({ session: "finance" })

  test("an entry is exported and deleted", async ({ page }) => {
    const note = tag()
    // Headless Chromium has no save dialog; take the anchor fallback.
    await page.addInitScript(() => {
      Object.defineProperty(window, "showSaveFilePicker", { value: undefined })
    })
    await page.goto("/cash-entries")
    await page.getByRole("button", { name: "Tambah Catatan" }).click()
    const dialog = page.getByRole("dialog", { name: "Tambah Catatan Kas" })
    await dialog.getByRole("button", { name: "Masuk" }).click()
    await dialog.getByLabel(/^Jumlah/).fill("500000")
    await dialog.getByLabel(/^Kategori/).fill("Setoran Modal")
    await dialog.getByLabel(/^Keterangan/).fill(note)
    await dialog.getByRole("button", { name: "Simpan" }).click()
    await expect(dialog).toBeHidden()

    await page.getByPlaceholder("Cari keterangan atau kategori...").fill(note)
    const row = page.getByRole("row").filter({ hasText: note })
    await expect(row).toContainText("Masuk")

    const download = page.waitForEvent("download")
    await page.getByRole("button", { name: "Ekspor Excel" }).click()
    const file = await download
    expect(file.suggestedFilename()).toBe("kas-lain.xlsx")
    expect((await readFile(await file.path())).subarray(0, 2).toString()).toBe("PK")

    await row.getByRole("button", { name: /^Hapus/ }).click()
    const confirm = page.getByRole("dialog", { name: "Hapus catatan kas?" })
    await confirm.getByRole("button", { name: "Hapus" }).click()
    await expect(confirm).toBeHidden()
    // The empty row quotes the search, so look for it, not for the note.
    await expect(page.getByRole("cell", { name: `Tidak ada hasil untuk "${note}".` })).toBeVisible()
  })
})
