import { expect, test } from "./fixtures"
import { adminCredentials, type Role } from "./support/env"

const allSections = [
  "Dashboard",
  "Dashboard Financial",
  "Dashboard Operasional",
  "Quotation",
  "Purchase Order",
  "Invoices",
  "Katalog Produk",
  "Daftar Vendor",
  "Daftar Klien",
  "Manajemen Pengguna",
] as const

const visible: Record<Role, readonly (typeof allSections)[number][]> = {
  superadmin: allSections,
  operational: [
    "Dashboard",
    "Dashboard Operasional",
    "Quotation",
    "Purchase Order",
    "Katalog Produk",
    "Daftar Vendor",
    "Daftar Klien",
  ],
  finance: [
    "Dashboard",
    "Dashboard Financial",
    "Invoices",
    "Katalog Produk",
    "Daftar Vendor",
    "Daftar Klien",
  ],
}

test.describe("login", () => {
  test.use({ session: "anonymous" })

  test("the login form signs a user in", async ({ page }) => {
    const admin = adminCredentials()
    await page.goto("/login")
    await page.getByLabel("Surel").fill(admin.email)
    await page.getByLabel("Kata Sandi", { exact: true }).fill(admin.password)
    await page.getByRole("button", { name: "Masuk" }).click()
    await expect(page).toHaveURL(/\/$/)
    await expect(
      page.getByRole("navigation").getByRole("link", { name: "Dashboard", exact: true }),
    ).toBeVisible()
  })
})

for (const role of Object.keys(visible) as Role[]) {
  test.describe(`${role} shell`, () => {
    test.use({ session: role })

    test("shows exactly the sections the role may open", async ({ page }) => {
      await page.goto("/")
      const nav = page.getByRole("navigation")
      for (const name of allSections) {
        const link = nav.getByRole("link", { name, exact: true })
        if (visible[role].includes(name)) await expect(link).toBeVisible()
        else await expect(link).toHaveCount(0)
      }
    })
  })
}
