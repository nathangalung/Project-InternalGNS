import { expect, type Session, test } from "./fixtures"

// Every route, per session.
//
// Each route is typed into the address bar.
//
// The expectation is written out from the CLAUDE.md role table, not derived
// from rbac.ts, so a wrong guard cannot agree with itself. Detail routes use
// an id that does not exist: the route's own "tidak ditemukan" state proves
// both the guard and the API let the reader through, since a 403 renders the
// error fallback instead.

const MISSING = "999999999"

type Grant = "superadmin" | "operational" | "operational_input" | "finance" | "finance_input"

type RouteCase = { path: string; heading: string; allowed: readonly Grant[] }

const everyone: readonly Grant[] = [
  "superadmin",
  "operational",
  "operational_input",
  "finance",
  "finance_input",
]
// Operational writers, who also open the editors
const sales: readonly Grant[] = ["superadmin", "operational", "operational_input"]
// The finance head reads quotations
const quotes: readonly Grant[] = [...sales, "finance"]
const money: readonly Grant[] = ["superadmin", "finance", "finance_input"]
const moneyBoard: readonly Grant[] = ["superadmin", "finance"]
const adminOnly: readonly Grant[] = ["superadmin"]

const routes: readonly RouteCase[] = [
  { path: "/", heading: "Dashboard Utama", allowed: everyone },
  { path: "/dashboard-financial", heading: "Dashboard Finansial", allowed: moneyBoard },
  { path: "/dashboard-operational", heading: "Dashboard Operasional", allowed: sales },
  { path: "/quotations", heading: "Daftar Quotation", allowed: quotes },
  { path: "/quotations/add", heading: "Tambah Quotation Baru", allowed: sales },
  { path: `/quotations/${MISSING}`, heading: "Quotation tidak ditemukan", allowed: quotes },
  { path: `/quotations/${MISSING}/edit`, heading: "Quotation tidak ditemukan", allowed: sales },
  { path: "/purchase-orders", heading: "Daftar Purchase Order", allowed: everyone },
  {
    path: `/purchase-orders/${MISSING}`,
    heading: "Purchase Order tidak ditemukan",
    allowed: everyone,
  },
  {
    path: `/purchase-orders/${MISSING}/edit`,
    heading: "Purchase Order tidak ditemukan",
    allowed: sales,
  },
  { path: "/invoices", heading: "Daftar Invoice", allowed: money },
  { path: `/invoices/${MISSING}`, heading: "Invoice tidak ditemukan", allowed: money },
  { path: "/clients", heading: "Daftar Klien", allowed: everyone },
  { path: `/clients/${MISSING}`, heading: "Klien tidak ditemukan", allowed: everyone },
  { path: "/vendors", heading: "Daftar Vendor", allowed: everyone },
  { path: `/vendors/${MISSING}`, heading: "Vendor tidak ditemukan", allowed: everyone },
  { path: "/products", heading: "Katalog Produk", allowed: everyone },
  { path: `/products/${MISSING}`, heading: "Produk tidak ditemukan", allowed: everyone },
  { path: "/users", heading: "Manajemen Pengguna", allowed: adminOnly },
  { path: `/users/${MISSING}`, heading: "Pengguna tidak ditemukan", allowed: adminOnly },
]

const sessions: readonly Session[] = [
  "superadmin",
  "operational",
  "operational_input",
  "finance",
  "finance_input",
  "anonymous",
]

// Pathname only, exact.
function atPath(path: string): RegExp {
  const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return new RegExp(`^[^/]+//[^/]+${escaped}(\\?.*)?$`)
}

for (const session of sessions) {
  test.describe(`${session} route matrix`, () => {
    test.use({ session })

    for (const route of routes) {
      const allowed = session !== "anonymous" && route.allowed.includes(session)
      const verdict =
        session === "anonymous" ? "goes to login" : allowed ? "opens" : "returns to the dashboard"

      test(`${route.path} ${verdict}`, async ({ page }) => {
        await page.goto(route.path)
        if (session === "anonymous") {
          await expect(page).toHaveURL(atPath("/login"))
          await expect(page.getByRole("heading", { name: "Halo!" })).toBeVisible()
          return
        }
        if (allowed) {
          await expect(
            page.getByRole("heading", { name: route.heading, exact: true }),
          ).toBeVisible()
          await expect(page).toHaveURL(atPath(route.path))
          return
        }
        await expect(page).toHaveURL(atPath("/"))
        await expect(page.getByRole("heading", { name: "Dashboard Utama" })).toBeVisible()
      })
    }

    if (session !== "anonymous") {
      test("/login returns a signed-in reader to the dashboard", async ({ page }) => {
        await page.goto("/login")
        await expect(page).toHaveURL(atPath("/"))
        await expect(page.getByRole("heading", { name: "Dashboard Utama" })).toBeVisible()
      })

      test("an unknown address shows the not-found page", async ({ page }) => {
        await page.goto("/tidak-ada-halaman-ini")
        await expect(page.getByRole("heading", { name: /tidak ditemukan/i })).toBeVisible()
      })
    }
  })
}
