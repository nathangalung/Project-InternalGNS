import type { BrowserContext, Page } from "@playwright/test"
import { test as base, expect, savedTokens } from "./fixtures"
import { call, findUser, generatePassword, ownIp } from "./support/api"
import { createUser, type SeedUser, setUser, uniqueTag } from "./support/finance"
import { signedInContext, submitLogin } from "./support/session"

// User management as the superadmin, plus the self-service password change
// every role has. Every account a test touches is a throwaway one: ending
// its sessions must never sign out the users the other specs share.

type Role = "superadmin" | "operational" | "finance"
type Reader = { user: SeedUser; page: Page }

const test = base.extend<{
  admin: string
  makeUser: (role: Role) => Promise<SeedUser>
  signIn: (role: Role) => Promise<Reader>
}>({
  // biome-ignore lint/correctness/noEmptyPattern: Playwright needs the destructured argument
  admin: async ({}, use) => use(savedTokens("superadmin").token),
  makeUser: async ({ admin }, use) => {
    const made: SeedUser[] = []
    await use(async (role) => {
      const user = await createUser(admin, role, uniqueTag())
      made.push(user)
      return user
    })
    for (const user of made) await setUser(admin, user, { isActive: false })
  },
  // A throwaway user with a live session in a second browser.
  signIn: async ({ browser, makeUser }, use) => {
    const contexts: BrowserContext[] = []
    await use(async (role) => {
      const user = await makeUser(role)
      const { context, page } = await signedInContext(browser, user)
      contexts.push(context)
      return { user, page }
    })
    for (const context of contexts) await context.close()
  },
})

// Fresh-address login status.
async function loginStatus(email: string, password: string): Promise<number> {
  const res = await call("/auth/login", {
    method: "POST",
    ip: ownIp(),
    body: JSON.stringify({ email, password }),
  })
  return res.status
}

async function openUser(page: Page, id: number) {
  await page.goto(`/users/${id}`)
  await expect(page.getByRole("heading", { name: "Detail Pengguna" })).toBeVisible()
}

async function save(page: Page) {
  const saved = page.waitForResponse(
    (r) => r.request().method() === "PUT" && /\/users\/\d+$/.test(r.url()),
  )
  await page.getByRole("button", { name: "Simpan Perubahan" }).click()
  expect((await saved).status()).toBe(200)
}

// The reader's session has ended.
async function expectSignedOut(page: Page) {
  await page.goto("/")
  await expect(page).toHaveURL(/\/login$/)
}

test("an admin creates a least-privilege user who can sign in", async ({ page, admin }) => {
  const tag = uniqueTag()
  const email = `${tag.toLowerCase()}@globalsakti.com`
  const password = generatePassword()
  await page.goto("/users")
  await page.getByRole("button", { name: "Tambah Pengguna" }).click()
  const dialog = page.getByRole("dialog", { name: "Tambah Pengguna" })

  try {
    await test.step("the form starts on Operasional and holds a weak password", async () => {
      await expect(dialog.getByRole("button", { name: "Operasional" })).toHaveAttribute(
        "aria-pressed",
        "true",
      )
      await expect(dialog.getByRole("button", { name: "Super Admin" })).toHaveAttribute(
        "aria-pressed",
        "false",
      )
      await dialog.getByLabel(/^Nama Lengkap/).fill(`Pengguna ${tag}`)
      await dialog.getByLabel(/^Alamat Email/).fill(email)
      await dialog.getByLabel(/^Kata Sandi/).fill("lemah")
      await expect(dialog.getByRole("button", { name: "Simpan Akun" })).toBeDisabled()
    })

    await test.step("a strong password saves the account", async () => {
      await dialog.getByLabel(/^Kata Sandi/).fill(password)
      await dialog.getByRole("button", { name: "Simpan Akun" }).click()
      await expect(dialog).toBeHidden()
      await page.getByPlaceholder("Cari nama atau email...").fill(email)
      const row = page.getByRole("row").filter({ hasText: email })
      await expect(row).toContainText(`Pengguna ${tag}`)
      await expect(row).toContainText(/operasional/i)
    })

    await test.step("the account signs in with the operational role", async () => {
      const res = await call("/auth/login", {
        method: "POST",
        ip: ownIp(),
        body: JSON.stringify({ email, password }),
      })
      expect(res.status).toBe(200)
      const { token } = (await res.json()) as { token: string }
      const me = (await (await call("/auth/me", { token })).json()) as { role: string }
      expect(me.role).toBe("operational")
    })
  } finally {
    const made = await findUser(admin, email).catch(() => null)
    if (made) await setUser(admin, made, { isActive: false })
  }
})

test("a taken email is flagged on its field", async ({ page, makeUser }) => {
  const existing = await makeUser("finance")
  await page.goto("/users")
  await page.getByRole("button", { name: "Tambah Pengguna" }).click()
  const dialog = page.getByRole("dialog", { name: "Tambah Pengguna" })
  await dialog.getByLabel(/^Nama Lengkap/).fill("Pengguna Kembar")
  await dialog.getByLabel(/^Alamat Email/).fill(existing.email.toUpperCase())
  await dialog.getByLabel(/^Kata Sandi/).fill(generatePassword())
  await dialog.getByRole("button", { name: "Simpan Akun" }).click()
  await expect(dialog.getByText("Email sudah digunakan pengguna lain.")).toBeVisible()
  await expect(dialog).toBeVisible()
})

test("deactivating ends the live session, and the inactive user can be reactivated (AU-1, AU-5)", async ({
  page,
  signIn,
}) => {
  const victim = await signIn("operational")
  await victim.page.goto("/quotations")
  await expect(victim.page.getByRole("heading", { name: "Daftar Quotation" })).toBeVisible()

  await test.step("deactivate", async () => {
    await openUser(page, victim.user.id)
    await page.getByRole("switch", { name: "Status Akun" }).click()
    await expect(page.getByText("Pengguna akan keluar dari semua sesi.")).toBeVisible()
    await save(page)
    await expect(page.getByText("Nonaktif", { exact: true })).toBeVisible()
  })

  await test.step("the old session and the password stop working", async () => {
    await expectSignedOut(victim.page)
    expect(await loginStatus(victim.user.email, victim.user.password)).toBe(401)
  })

  await test.step("the inactive user still opens and can be reactivated", async () => {
    await openUser(page, victim.user.id)
    await expect(page.getByText("Nonaktif", { exact: true })).toBeVisible()
    await expect(page.getByRole("switch", { name: "Status Akun" })).toHaveAttribute(
      "aria-checked",
      "false",
    )
    await page.getByRole("switch", { name: "Status Akun" }).click()
    await save(page)
    await expect(page.getByText("Aktif", { exact: true })).toBeVisible()
    expect(await loginStatus(victim.user.email, victim.user.password)).toBe(200)
  })
})

test("a role change reaches the open session at once (AU-2)", async ({ page, signIn }) => {
  const victim = await signIn("operational")
  const nav = victim.page.getByRole("navigation")
  await victim.page.goto("/")
  await expect(nav.getByRole("link", { name: "Quotation", exact: true })).toBeVisible()
  const refreshToken = await victim.page.evaluate(() => sessionStorage.getItem("gns_refresh_token"))

  await openUser(page, victim.user.id)
  await page.getByRole("button", { name: /^Peran/ }).click()
  await page.getByRole("button", { name: "Finance", exact: true }).click()
  await save(page)
  await expect(page.getByRole("button", { name: /^Peran/ })).toContainText("Finance")

  // The API reads the role per request, so the same token now acts as finance.
  await victim.page.reload()
  await expect(nav.getByRole("link", { name: "Invoices", exact: true })).toBeVisible()
  await expect(nav.getByRole("link", { name: "Quotation", exact: true })).toHaveCount(0)
  await victim.page.goto("/quotations")
  await expect(victim.page).toHaveURL(/\/$/)
  // The session cannot outlive its access token: refresh was revoked.
  const res = await call("/auth/refresh", {
    method: "POST",
    ip: ownIp(),
    body: JSON.stringify({ refreshToken }),
  })
  expect(res.status).toBe(401)
})

test("an admin password reset ends the user's session (AU-11)", async ({ page, signIn }) => {
  const victim = await signIn("finance")
  await victim.page.goto("/invoices")
  await expect(victim.page.getByRole("heading", { name: "Daftar Invoice" })).toBeVisible()

  const fresh = generatePassword()
  await openUser(page, victim.user.id)
  await page.getByLabel("Kata Sandi Baru", { exact: true }).fill(fresh)
  await save(page)

  await expectSignedOut(victim.page)
  expect(await loginStatus(victim.user.email, victim.user.password)).toBe(401)
  expect(await loginStatus(victim.user.email, fresh)).toBe(200)
})

test("a user changes their own password from the sidebar", async ({ signIn }) => {
  const { user, page } = await signIn("finance")
  const fresh = generatePassword()
  await page.goto("/")
  await page.getByRole("button", { name: "Ubah Kata Sandi" }).click()
  const dialog = page.getByRole("dialog", { name: "Ubah Kata Sandi" })
  const submit = dialog.getByRole("button", { name: "Ubah Kata Sandi" })

  await test.step("a mismatched confirmation cannot be sent", async () => {
    await dialog.getByLabel(/^Kata Sandi Saat Ini/).fill(user.password)
    await dialog.getByLabel(/^Kata Sandi Baru/).fill(fresh)
    await dialog.getByLabel(/^Ulangi Kata Sandi Baru/).fill(`${fresh}x`)
    await expect(dialog.getByText("Konfirmasi kata sandi tidak sama.")).toBeVisible()
    await expect(submit).toBeDisabled()
  })

  await test.step("a wrong current password is flagged on its field", async () => {
    await dialog.getByLabel(/^Kata Sandi Saat Ini/).fill(`${user.password}x`)
    await dialog.getByLabel(/^Ulangi Kata Sandi Baru/).fill(fresh)
    await submit.click()
    await expect(dialog.getByText("Kata sandi saat ini salah.")).toBeVisible()
  })

  await test.step("the right one signs the user out to log in again", async () => {
    await dialog.getByLabel(/^Kata Sandi Saat Ini/).fill(user.password)
    await submit.click()
    await expect(page).toHaveURL(/\/login$/)
    await expect(
      page.getByText("Kata sandi berhasil diubah. Silakan masuk kembali dengan kata sandi baru."),
    ).toBeVisible()
  })

  await test.step("only the new password works", async () => {
    expect((await submitLogin(page, user.email, user.password)).status()).toBe(401)
    expect((await submitLogin(page, user.email, fresh)).status()).toBe(200)
    await expect(page.getByRole("heading", { name: "Dashboard Utama" })).toBeVisible()
  })
})

test("a superadmin's own edit reaches the shell at once (AU-10)", async ({ signIn }) => {
  const { user, page } = await signIn("superadmin")
  const renamed = `${user.name} Baru`
  await openUser(page, user.id)
  await page.getByLabel("Nama Lengkap").fill(renamed)
  await save(page)
  // The sidebar reads the cached me query; no reload.
  await expect(page.locator("aside").getByText(renamed, { exact: true })).toBeVisible()
})
