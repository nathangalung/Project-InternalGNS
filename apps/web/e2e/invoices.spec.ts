import type { Page } from "@playwright/test"
import { test as base, expect, savedTokens } from "./fixtures"
import { call } from "./support/api"
import {
  createClient,
  deactivateClient,
  deliveredInvoice,
  patchInvoiceDates,
  type SeedClient,
  type SeedInvoice,
  setInvoiceDates,
  setInvoiceStatus,
  uniqueTag,
  wibDay,
} from "./support/finance"

// Invoice work as finance, the role the page exists for. Each test files its
// own invoice through a delivered PO; the client is deactivated afterwards.

const test = base.extend<{ admin: string; client: SeedClient; invoice: SeedInvoice }>({
  // biome-ignore lint/correctness/noEmptyPattern: Playwright needs the destructured argument
  admin: async ({}, use) => use(savedTokens("superadmin").token),
  client: async ({ admin }, use) => {
    const client = await createClient(admin, uniqueTag())
    await use(client)
    await deactivateClient(admin, client.id)
  },
  invoice: async ({ admin, client }, use) => use(await deliveredInvoice(admin, client)),
})

test.use({ session: "finance" })

const ACTIONS = ["Tandai Dikirim", "Tandai Dibayar", "Batalkan & Terbitkan Pengganti"] as const

function statusBar(page: Page) {
  return page.getByRole("region", { name: "Status Invoice" })
}

// Exactly these status buttons.
async function expectActions(page: Page, offered: readonly string[]) {
  const bar = statusBar(page)
  for (const name of [...ACTIONS, "Terbitkan Pengganti", "Terlambat"]) {
    const button = bar.getByRole("button", { name, exact: true })
    if (offered.includes(name)) await expect(button).toBeVisible()
    else await expect(button).toHaveCount(0)
  }
}

async function openInvoice(page: Page, inv: Pick<SeedInvoice, "quotationId" | "invoiceNo">) {
  await page.goto(`/invoices/${inv.quotationId}`)
  await expect(page.getByRole("heading", { name: `Invoice ${inv.invoiceNo}` })).toBeVisible()
}

// Confirm the open step's dialog.
async function confirm(page: Page, title: string, submit: string) {
  const dialog = page.getByRole("dialog", { name: title })
  await dialog.getByRole("button", { name: submit, exact: true }).click()
  await expect(dialog).toBeHidden()
}

test("finance finds a new invoice in the list and opens it", async ({ page, client, invoice }) => {
  await page.goto("/invoices")
  await page.getByPlaceholder("Cari invoice, klien, atau nomor...").fill(client.name)
  const row = page.getByRole("row").filter({ hasText: invoice.invoiceNo })
  await expect(row).toHaveCount(1)
  await expect(row).toContainText("Draf")
  await row.getByRole("link", { name: invoice.invoiceNo }).click()
  await expect(page).toHaveURL(new RegExp(`/invoices/${invoice.quotationId}$`))
  await expect(page.getByRole("heading", { name: `Invoice ${invoice.invoiceNo}` })).toBeVisible()
})

test("finance reads the header from the invoice alone (INV-1)", async ({
  page,
  client,
  invoice,
}) => {
  const forbidden: string[] = []
  page.on("response", (res) => {
    if (res.status() === 403) forbidden.push(res.url())
  })
  await openInvoice(page, invoice)
  const header = page.locator("main")
  await expect(header.getByText(`No. PO: ${invoice.poNumber}`)).toBeVisible()
  await expect(header.getByRole("link", { name: client.name })).toBeVisible()
  // Finance may not open quotations or POs, so those stay plain text.
  await expect(header.getByText(invoice.quotationNo)).toBeVisible()
  await expect(header.getByRole("link", { name: invoice.quotationNo })).toHaveCount(0)
  await expect(header.getByRole("link", { name: invoice.poNumber })).toHaveCount(0)
  await expect(page.getByText("Tali Tambat E2E")).toBeVisible()
  expect(forbidden).toEqual([])
})

test("a draft is sent, then paid with a proof, and locks (INV-2, INV-4, INV-8)", async ({
  page,
  admin,
  invoice,
}) => {
  await openInvoice(page, invoice)

  await test.step("a draft offers only send and cancel", async () => {
    await expect(statusBar(page).getByText("Draf", { exact: true })).toBeVisible()
    await expectActions(page, ["Tandai Dikirim", "Batalkan & Terbitkan Pengganti"])
  })

  await test.step("mark it sent", async () => {
    await statusBar(page).getByRole("button", { name: "Tandai Dikirim" }).click()
    await confirm(page, "Tandai Invoice Dikirim", "Tandai Dikirim")
    await expect(page.getByText("Invoice ditandai Dikirim.")).toBeVisible()
    await expect(statusBar(page).getByText("Dikirim", { exact: true })).toBeVisible()
    await expectActions(page, ["Tandai Dibayar", "Batalkan & Terbitkan Pengganti"])
  })

  await test.step("mark it paid with a proof", async () => {
    await statusBar(page).getByRole("button", { name: "Tandai Dibayar" }).click()
    const dialog = page.getByRole("dialog", { name: "Tandai Invoice Dibayar" })
    await dialog.getByLabel("Bukti Pembayaran (opsional)").setInputFiles({
      name: "bukti-transfer.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4\n%e2e payment proof\n%%EOF\n"),
    })
    await confirm(page, "Tandai Invoice Dibayar", "Tandai Dibayar")
    await expect(page.getByText("Invoice ditandai Dibayar.")).toBeVisible()
  })

  await test.step("a paid invoice is final", async () => {
    await expect(statusBar(page).getByText("Dibayar", { exact: true })).toBeVisible()
    await expect(statusBar(page).getByText(/^Dibayar pada /)).toBeVisible()
    await expectActions(page, [])
    await expect(page.getByRole("textbox", { name: "Tanggal Invoice" })).toBeDisabled()
    await expect(page.getByRole("textbox", { name: "Jatuh Tempo" })).toBeDisabled()
    await expect(
      page.getByText("Tanggal invoice yang sudah dibayar atau dibatalkan tidak dapat diubah."),
    ).toBeVisible()
    await expect(page.getByRole("button", { name: "Simpan Tanggal" })).toHaveCount(0)
  })

  await test.step("the history keeps both steps and the proof", async () => {
    await expect(page.getByText("Draf → Dikirim")).toBeVisible()
    await expect(page.getByText("Dikirim → Dibayar")).toBeVisible()
    const popup = page.waitForEvent("popup")
    await page.getByRole("button", { name: "Unduh bukti pembayaran" }).click()
    await popup
  })

  await test.step("the server stored the payment", async () => {
    const res = await call(`/invoices/${invoice.id}`, { token: admin })
    const stored = (await res.json()) as {
      status: string
      paidAt?: string
      paymentProofKey?: string
    }
    expect(stored.status).toBe("paid")
    expect(stored.paidAt).toBeTruthy()
    expect(stored.paymentProofKey).toMatch(new RegExp(`^invoices/${invoice.id}/payment/`))
    // The lock is the server's, not only the disabled inputs.
    const moved = await patchInvoiceDates(admin, invoice.id, wibDay(), wibDay(30))
    expect(moved.status).toBe(422)
  })
})

test("dates save in order and a due date before the invoice date is refused (INV-9)", async ({
  page,
  admin,
  invoice,
}) => {
  await openInvoice(page, invoice)
  const issued = page.getByRole("textbox", { name: "Tanggal Invoice" })
  const due = page.getByRole("textbox", { name: "Jatuh Tempo" })
  const saveDates = page.getByRole("button", { name: "Simpan Tanggal" })

  await test.step("the page refuses a due date before the invoice date", async () => {
    await issued.fill(wibDay(-5))
    await due.fill(wibDay(-10))
    await expect(
      page.getByText("Tanggal jatuh tempo tidak boleh sebelum tanggal invoice."),
    ).toBeVisible()
    await expect(saveDates).toBeDisabled()
  })

  await test.step("so does the API", async () => {
    const res = await patchInvoiceDates(admin, invoice.id, wibDay(-5), wibDay(-10))
    expect(res.status).toBe(422)
    const body = (await res.json()) as { fields?: Record<string, string> }
    expect(body.fields?.dueDate).toBe("Tanggal jatuh tempo tidak boleh sebelum tanggal invoice.")
  })

  await test.step("an ordered pair saves", async () => {
    await due.fill(wibDay(25))
    await saveDates.click()
    await expect(page.getByText("Tanggal invoice disimpan.")).toBeVisible()
    const res = await call(`/invoices/${invoice.id}`, { token: admin })
    const stored = (await res.json()) as { invoiceDate: string; dueDate: string }
    expect(stored.invoiceDate.slice(0, 10)).toBe(wibDay(-5))
    expect(stored.dueDate.slice(0, 10)).toBe(wibDay(25))
  })
})

test("a past-due invoice reads Terlambat and still takes a payment", async ({
  page,
  admin,
  invoice,
}) => {
  await setInvoiceDates(admin, invoice.id, wibDay(-40), wibDay(-10))
  await setInvoiceStatus(admin, invoice.id, "sent")
  await openInvoice(page, invoice)

  const bar = statusBar(page)
  await expect(bar.getByText("Terlambat", { exact: true })).toBeVisible()
  await expect(
    bar.getByText("Terlambat ditentukan otomatis dari tanggal jatuh tempo."),
  ).toBeVisible()
  // Terlambat is derived, never a step to pick.
  await expectActions(page, ["Tandai Dibayar", "Batalkan & Terbitkan Pengganti"])

  await bar.getByRole("button", { name: "Tandai Dibayar" }).click()
  await confirm(page, "Tandai Invoice Dibayar", "Tandai Dibayar")
  await expect(bar.getByText("Dibayar", { exact: true })).toBeVisible()
  await expectActions(page, [])
})

test("cancelling needs a reason and issues the Pengganti", async ({ page, invoice }) => {
  const reason = "Salah alamat penagihan"
  await openInvoice(page, invoice)

  let replacementNo = ""
  await test.step("an empty reason is refused in place", async () => {
    await statusBar(page).getByRole("button", { name: "Batalkan & Terbitkan Pengganti" }).click()
    const dialog = page.getByRole("dialog", { name: "Batalkan & Terbitkan Pengganti" })
    await dialog.getByRole("button", { name: "Batalkan & Terbitkan", exact: true }).click()
    await expect(dialog.getByText("Alasan pembatalan wajib diisi.")).toBeVisible()
    await expect(dialog.getByLabel("Alasan Pembatalan")).toBeFocused()
  })

  await test.step("a reason cancels and lands on the Pengganti", async () => {
    const dialog = page.getByRole("dialog", { name: "Batalkan & Terbitkan Pengganti" })
    await dialog.getByLabel("Alasan Pembatalan").fill(reason)
    await confirm(page, "Batalkan & Terbitkan Pengganti", "Batalkan & Terbitkan")
    const toast = page.getByText(/^Invoice pengganti (.+) diterbitkan\.$/)
    await expect(toast).toBeVisible()
    replacementNo = /^Invoice pengganti (.+) diterbitkan\.$/.exec(
      (await toast.textContent()) ?? "",
    )?.[1] as string
    expect(replacementNo).not.toBe(invoice.invoiceNo)
    await expect(page.getByRole("heading", { name: `Invoice ${replacementNo}` })).toBeVisible()
    await expect(statusBar(page).getByText("Draf", { exact: true })).toBeVisible()
    await expect(
      page.getByText(`Dibuat sebagai Draf, pengganti ${invoice.invoiceNo}`),
    ).toBeVisible()
    await expectActions(page, ["Tandai Dikirim", "Batalkan & Terbitkan Pengganti"])
  })

  await test.step("the original is cancelled and points forward", async () => {
    await statusBar(page).getByRole("link", { name: invoice.invoiceNo }).click()
    await expect(page.getByRole("heading", { name: `Invoice ${invoice.invoiceNo}` })).toBeVisible()
    const bar = statusBar(page)
    await expect(bar.getByText("Dibatalkan", { exact: true })).toBeVisible()
    await expect(bar.getByText(`Dibatalkan. Alasan: ${reason}`)).toBeVisible()
    await expectActions(page, [])
    await bar.getByRole("link", { name: "invoice pengganti" }).click()
    await expect(page.getByRole("heading", { name: `Invoice ${replacementNo}` })).toBeVisible()
  })
})

test("a cancelled invoice without a Pengganti offers one (INV-10)", async ({
  page,
  admin,
  invoice,
}) => {
  await setInvoiceStatus(admin, invoice.id, "cancelled", "Dibatalkan lewat API")
  await openInvoice(page, invoice)
  await expectActions(page, ["Terbitkan Pengganti"])

  await statusBar(page).getByRole("button", { name: "Terbitkan Pengganti" }).click()
  await confirm(page, "Terbitkan Invoice Pengganti", "Terbitkan Pengganti")
  await expect(page.getByText(/^Invoice pengganti .+ diterbitkan\.$/)).toBeVisible()
  await expect(statusBar(page).getByText(`Menggantikan ${invoice.invoiceNo}`)).toBeVisible()
  await expect(page.getByRole("heading", { name: `Invoice ${invoice.invoiceNo}` })).toHaveCount(0)
  await expectActions(page, ["Tandai Dikirim", "Batalkan & Terbitkan Pengganti"])
})
