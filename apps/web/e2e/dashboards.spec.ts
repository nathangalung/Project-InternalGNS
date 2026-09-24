import { readFile } from "node:fs/promises"
import type { Page } from "@playwright/test"
import { test as base, expect, savedTokens } from "./fixtures"
import { call } from "./support/api"
import {
  createClient,
  deactivateClient,
  deliveredInvoice,
  type SeedClient,
  setInvoiceStatus,
  uniqueTag,
} from "./support/finance"

// What each role sees on the dashboards. Totals move while parallel specs
// file invoices, so these tests assert which figures, tabs and links a role
// gets, never the figures themselves.

type Summary = {
  totalRevenue: string
  totalInvoices: number
  invoiceStatuses: { status: string; label: string; count: number }[]
}

const test = base.extend<{ admin: string; client: SeedClient }>({
  // biome-ignore lint/correctness/noEmptyPattern: Playwright needs the destructured argument
  admin: async ({}, use) => use(savedTokens("superadmin").token),
  client: async ({ admin }, use) => {
    const client = await createClient(admin, uniqueTag())
    await use(client)
    await deactivateClient(admin, client.id)
  },
})

const FINANCIAL_CARDS = [
  "Total Pendapatan (DPP)",
  "Total Pengeluaran",
  "Total Laba Bersih",
  "Total PPN",
  "Total Invoice",
  "Total Invoice Dibayar",
] as const

const COMMON_CARDS = [
  "Total Quotation",
  "Total Quotation Ditolak",
  "Total Purchase Order Aktif",
] as const

const CHART_TABS = ["Quotation", "Invoice", "Pendapatan (DPP)", "Laba Bersih", "PPN"] as const

// Linked cards are buttons.
async function expectLinked(page: Page, label: string, linked: boolean) {
  await expect(page.getByText(label, { exact: true })).toBeVisible()
  const button = page.getByRole("button").filter({ has: page.getByText(label, { exact: true }) })
  await expect(button).toHaveCount(linked ? 1 : 0)
}

async function openOverview(page: Page) {
  await page.goto("/")
  await expect(page.getByRole("heading", { name: "Dashboard Utama" })).toBeVisible()
  await expect(page.getByText("Total Quotation", { exact: true })).toBeVisible()
}

test.describe("superadmin", () => {
  test("the overview shows every figure, tab and link", async ({ page }) => {
    await openOverview(page)
    for (const label of [...FINANCIAL_CARDS, ...COMMON_CARDS]) await expectLinked(page, label, true)
    for (const name of CHART_TABS) {
      await expect(
        page.getByRole("button", { name, exact: true, pressed: name === "Quotation" }),
      ).toBeVisible()
    }
    await expect(page.getByRole("button", { name: "Ekspor Excel" })).toBeVisible()
    await page.getByRole("button").filter({ hasText: "Total Purchase Order Aktif" }).click()
    await expect(page).toHaveURL(/\/purchase-orders$/)
  })
})

test.describe("operational", () => {
  test.use({ session: "operational" })

  test("the overview hides every financial figure, in the page and the payload", async ({
    page,
    admin,
    client,
  }) => {
    // At least one invoice exists, so a zero below is stripping, not absence.
    await deliveredInvoice(admin, client)
    const full = (await (await call("/dashboard/summary", { token: admin })).json()) as Summary
    expect(full.totalInvoices).toBeGreaterThan(0)

    const summary = page.waitForResponse((r) => r.url().includes("/dashboard/summary"))
    await openOverview(page)
    const stripped = (await (await summary).json()) as Summary
    expect(stripped.totalRevenue).toBe("0")
    expect(stripped.totalInvoices).toBe(0)
    expect(stripped.invoiceStatuses).toEqual([])

    for (const label of FINANCIAL_CARDS) {
      await expect(page.getByText(label, { exact: true })).toHaveCount(0)
    }
    for (const label of COMMON_CARDS) await expectLinked(page, label, true)
    await expect(page.getByRole("button", { name: "Quotation", exact: true })).toBeVisible()
    for (const name of CHART_TABS.slice(1)) {
      await expect(page.getByRole("button", { name, exact: true })).toHaveCount(0)
    }
    await expect(page.getByRole("button", { name: "Ekspor Excel" })).toHaveCount(0)
  })

  test("the export stays refused through the API", async () => {
    const res = await call("/dashboard/export.xlsx", { token: savedTokens("operational").token })
    expect(res.status).toBe(403)
  })

  test("the operational dashboard lists every quotation and PO status", async ({ page }) => {
    await page.goto("/dashboard-operational")
    await expect(page.getByRole("heading", { name: "Dashboard Operasional" })).toBeVisible()
    const quotations = page.getByRole("region", { name: "Status Quotation" })
    const orders = page.getByRole("region", { name: "Status Purchase Order" })
    for (const label of ["Draf", "Dikirim", "Revisi", "Disetujui", "Ditolak", "Kedaluwarsa"]) {
      await expect(quotations.getByText(label, { exact: true })).toBeVisible()
    }
    await expect(orders.getByText("Dibatalkan", { exact: true })).toBeVisible()
    await expect(page.getByRole("region", { name: "Status Invoice" })).toHaveCount(0)
  })
})

test.describe("finance", () => {
  test.use({ session: "finance" })

  test("overview cards only link to pages finance can open (DASH-5)", async ({ page }) => {
    await openOverview(page)
    for (const label of COMMON_CARDS) await expectLinked(page, label, false)
    await expectLinked(page, "Total Pengeluaran", false)
    for (const label of FINANCIAL_CARDS.filter((l) => l !== "Total Pengeluaran")) {
      await expectLinked(page, label, true)
    }
    await page.getByRole("button").filter({ hasText: "Total Invoice Dibayar" }).click()
    await expect(page).toHaveURL(/\/invoices$/)
    await expect(page.getByRole("heading", { name: "Daftar Invoice" })).toBeVisible()
  })

  test("finance downloads the dashboard workbook", async ({ page }) => {
    // Headless Chromium has no save dialog; take the anchor fallback.
    await page.addInitScript(() => {
      Object.defineProperty(window, "showSaveFilePicker", { value: undefined })
    })
    await openOverview(page)
    const download = page.waitForEvent("download")
    await page.getByRole("button", { name: "Ekspor Excel" }).click()
    const file = await download
    expect(file.suggestedFilename()).toBe(`dashboard-export-${new Date().getFullYear()}.xlsx`)
    expect(await file.failure()).toBeNull()
    // An XLSX is a zip archive.
    expect((await readFile(await file.path())).subarray(0, 2).toString()).toBe("PK")
  })

  test("Invoice Terkini shows five rows and never a cancelled one (DASH-6)", async ({
    page,
    admin,
    client,
  }) => {
    test.slow()
    const filed = []
    for (let i = 0; i < 6; i++) filed.push(await deliveredInvoice(admin, client))
    const newest = filed[filed.length - 1]
    await setInvoiceStatus(admin, newest.id, "cancelled", "Uji dashboard")

    await page.goto("/dashboard-financial")
    await expect(page.getByRole("heading", { name: "Dashboard Finansial" })).toBeVisible()
    const statuses = page.getByRole("region", { name: "Status Invoice" })
    for (const label of ["Draf", "Dikirim", "Terlambat", "Dibayar", "Dibatalkan"]) {
      await expect(statuses.getByText(label, { exact: true })).toBeVisible()
    }

    const table = page.getByRole("table").filter({ hasText: "Nomor Invoice" })
    const rows = table.locator("tbody tr")
    await expect(rows).toHaveCount(5)
    await expect(table.getByText("Dibatalkan", { exact: true })).toHaveCount(0)
    await expect(table.getByText(newest.invoiceNo, { exact: true })).toHaveCount(0)
  })
})
