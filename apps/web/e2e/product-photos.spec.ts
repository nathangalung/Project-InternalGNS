import { deflateSync } from "node:zlib"
import type { Locator } from "@playwright/test"
import { api } from "./support/sales"
import { expect, test } from "./support/seed"

// Product photo flows.
//
// Add, view, replace and remove a catalog photo, its list thumbnail, and
// the read-only finance view.

type Item = { imageObjectKey?: string }

// CRC32 for PNG chunks.
function crc32(buf: Buffer): number {
  let c = ~0
  for (const byte of buf) {
    c ^= byte
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1
  }
  return ~c >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, "ascii"), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

// Solid-colour RGB PNG.
function png(width: number, height: number, rgb: [number, number, number]): Buffer {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header.set([8, 2, 0, 0, 0], 8)
  const row = Buffer.alloc(1 + width * 3)
  for (let x = 0; x < width; x++) row.set(rgb, 1 + x * 3)
  const raw = Buffer.concat(Array.from({ length: height }, () => row))
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ])
}

// Stored key from the API.
const storedKey = (id: number) => async () =>
  (await api<Item>("GET", `/items/${id}`)).imageObjectKey ?? ""

// Image decoded with real pixels.
async function expectDecoded(img: Locator) {
  await expect
    .poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0)
}

test("a product photo is added, viewed, replaced and removed", async ({ page, seed }) => {
  const item = await seed.item({ label: "Produk Foto" })
  await page.goto(`/products/${item.id}`)
  const add = page.getByRole("button", { name: "Tambah Foto" })
  await expect(add).toBeVisible()
  await expect(page.getByRole("button", { name: "Hapus Foto" })).toHaveCount(0)

  // A large photo is shrunk to WebP before upload.
  await page.locator('input[type="file"]').setInputFiles({
    name: "kamera.png",
    mimeType: "image/png",
    buffer: png(2000, 1500, [200, 30, 30]),
  })
  const view = page.getByRole("button", { name: `Lihat foto ${item.name}` })
  await expect(view).toBeVisible()
  await expect(page.getByRole("button", { name: "Ganti Foto" })).toBeEnabled()
  await expect.poll(storedKey(item.id)).toMatch(new RegExp(`^items/${item.id}/.+\\.webp$`))

  // The stored copy survives a reload and opens full size.
  await page.reload()
  await expectDecoded(view.locator("img"))
  await view.click()
  const preview = page.getByRole("dialog", { name: item.name })
  await expectDecoded(preview.getByRole("img", { name: `Foto ${item.name}` }))
  await page.keyboard.press("Escape")
  await expect(preview).toBeHidden()

  // A small photo is kept as it is.
  const first = await storedKey(item.id)()
  await page.locator('input[type="file"]').setInputFiles({
    name: "kecil.png",
    mimeType: "image/png",
    buffer: png(120, 90, [30, 30, 200]),
  })
  await expect.poll(storedKey(item.id)).toMatch(/\.png$/)
  expect(await storedKey(item.id)()).not.toBe(first)

  // The catalog list shows the thumbnail.
  await page.goto("/products")
  await page.getByPlaceholder("Cari kode IMPA, nama, kategori produk...").fill(item.name)
  const row = page.getByRole("row", { name: new RegExp(item.name) })
  await expectDecoded(row.locator("img"))

  // Removal asks first, then the initials return.
  await page.goto(`/products/${item.id}`)
  await page.getByRole("button", { name: "Hapus Foto" }).click()
  const confirm = page.getByRole("dialog", { name: "Hapus foto produk?" })
  await confirm.getByRole("button", { name: "Hapus Foto" }).click()
  await expect(confirm).toBeHidden()
  await expect(page.getByRole("button", { name: "Tambah Foto" })).toBeFocused()
  await expect(page.getByRole("button", { name: `Lihat foto ${item.name}` })).toHaveCount(0)
  await expect.poll(storedKey(item.id)).toBe("")
})

test("a file that is not a photo is refused before upload", async ({ page, seed }) => {
  const item = await seed.item({ label: "Produk Foto Salah" })
  await page.goto(`/products/${item.id}`)
  await page.locator('input[type="file"]').setInputFiles({
    name: "catatan.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("bukan foto"),
  })
  await expect(page.getByText(/Format foto produk tidak didukung/)).toBeVisible()
  await expect(page.getByRole("button", { name: "Tambah Foto" })).toBeEnabled()
  expect(await storedKey(item.id)()).toBe("")
})

test.describe("as finance", () => {
  test.use({ session: "finance" })

  test("finance sees no photo controls", async ({ page, seed }) => {
    const item = await seed.item()
    await page.goto(`/products/${item.id}`)
    await expect(page.getByRole("heading", { name: item.name, level: 2 })).toBeVisible()
    for (const name of ["Tambah Foto", "Ganti Foto", "Hapus Foto"]) {
      await expect(page.getByRole("button", { name })).toHaveCount(0)
    }
    await expect(page.locator('input[type="file"]')).toHaveCount(0)
  })
})
