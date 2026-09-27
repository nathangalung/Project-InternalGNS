import { expect, test } from "./fixtures"

// Pickers from the keyboard.
//
// The Base UI select and combobox pickers in a real browser: arrow keys and
// Enter pick, Escape closes only the list, and the empty row is Indonesian.
// Relies on the PCS unit and IDN country master rows, as products.spec does.

test("the unit picker in Filter Produk is driven by the keyboard", async ({ page }) => {
  await page.goto("/products")
  await page.getByRole("main").getByRole("button", { name: "Filter", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "Filter Produk" })
  const unit = dialog.getByRole("combobox", { name: "Satuan" })

  await unit.click()
  await expect(page.getByRole("listbox")).toHaveCount(0)
  await unit.fill("zzqx")
  await expect(page.getByText("Tidak ada hasil")).toBeVisible()

  await unit.fill("pcs")
  await expect(page.getByRole("option", { name: /^PCS/ })).toBeVisible()
  await page.keyboard.press("ArrowDown")
  await page.keyboard.press("Enter")
  await expect(unit).toHaveValue("PCS")
  await expect(page.getByRole("listbox")).toHaveCount(0)

  await unit.fill("pc")
  await expect(page.getByRole("listbox")).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(page.getByRole("listbox")).toHaveCount(0)
  await expect(dialog).toBeVisible()
})

test("the year select in the dashboard filter opens, picks and closes", async ({ page }) => {
  await page.goto("/dashboard-financial")
  await page.getByRole("main").getByRole("button", { name: "Filter", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "Filter Dashboard Finansial" })
  const year = dialog.getByRole("combobox", { name: /^Pilih Tahun/ })
  const current = String(new Date().getFullYear())
  await expect(year).toContainText(current)

  await year.focus()
  await page.keyboard.press("ArrowDown")
  await expect(page.getByRole("option", { name: current })).toBeFocused()
  await page.keyboard.press("Escape")
  await expect(page.getByRole("listbox")).toHaveCount(0)
  await expect(dialog).toBeVisible()
  await expect(year).toBeFocused()

  await page.keyboard.press("ArrowDown")
  await page.keyboard.press("End")
  await page.keyboard.press("Enter")
  await expect(year).toContainText("2024")
})

test("the country code picker searches inside its panel", async ({ page }) => {
  await page.goto("/clients")
  await page.getByRole("main").getByRole("button", { name: "Tambah Klien" }).click()
  const dialog = page.getByRole("dialog", { name: "Tambah Klien" })
  const country = dialog.getByRole("combobox", { name: /^Kode Negara/ })
  await expect(country).toBeDisabled()
  await dialog.getByLabel("Nama Perusahaan *").fill("Uji Pemilih Negara")
  await expect(country).toHaveText("IDN - Indonesia")

  await country.click()
  const search = page.getByRole("combobox", { name: "Cari negara" })
  await expect(search).toBeFocused()
  await search.fill("zzqx")
  await expect(page.getByText("Tidak ada hasil")).toBeVisible()
  await search.fill("idn")
  await page.keyboard.press("ArrowDown")
  await page.keyboard.press("Enter")
  await expect(country).toHaveText("IDN - Indonesia")
  await expect(dialog).toBeVisible()
})
