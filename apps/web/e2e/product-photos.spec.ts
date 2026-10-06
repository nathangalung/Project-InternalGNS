import { deflateSync } from "node:zlib"
import type { Locator } from "@playwright/test"
import { api } from "./support/sales"
import { expect, test } from "./support/seed"

// Product photo flows.
//
// Add several photos, swipe the gallery, pick the cover, remove photos, the
// list thumbnail, the maximum, and the read-only finance view.

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

// Image decoded with real pixels.
async function expectDecoded(img: Locator) {
  await expect
    .poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0)
}

type Gallery = { max: number; images: { objectKey: string; isCover: boolean }[] }

// Stored photos, cover first.
const photos = (id: number) => async () =>
  (await api<Gallery>("GET", `/items/${id}/images`)).images.map((p) => [
    p.objectKey.split(".").pop(),
    p.isCover,
  ])

const red = { name: "kamera.png", mimeType: "image/png", buffer: png(2000, 1500, [200, 30, 30]) }
const blue = { name: "kecil.png", mimeType: "image/png", buffer: png(120, 90, [30, 30, 200]) }

test("product photos are added, swiped, made the cover and removed", async ({ page, seed }) => {
  const item = await seed.item({ label: "Produk Foto" })
  await page.goto(`/products/${item.id}`)
  await expect(page.getByRole("button", { name: "Tambah Foto (0/8)" })).toBeEnabled()
  await expect(page.getByRole("heading", { name: "Foto Produk" })).toHaveCount(0)

  // Two at once: the large one is shrunk to WebP, the small one kept.
  await page.locator('input[type="file"]').setInputFiles([red, blue])
  await expect(page.getByRole("button", { name: "Tambah Foto (2/8)" })).toBeEnabled()
  await expect.poll(photos(item.id)).toEqual([
    ["webp", true],
    ["png", false],
  ])
  const gallery = page.getByRole("region", { name: `Foto ${item.name}` })
  await expect(page.getByText("1 / 2")).toBeVisible()
  await expectDecoded(gallery.getByRole("img", { name: `Foto 1 dari 2 ${item.name}` }))

  // Swipe on: arrow, dot and keyboard all move the strip.
  await gallery.getByRole("button", { name: "Foto berikutnya" }).click()
  await expect(page.getByText("2 / 2")).toBeVisible()
  await expectDecoded(gallery.getByRole("img", { name: `Foto 2 dari 2 ${item.name}` }))
  await page.getByRole("button", { name: "Foto 1", exact: true }).click()
  await expect(page.getByText("1 / 2")).toBeVisible()
  await page.getByRole("button", { name: "Foto 2", exact: true }).press("ArrowLeft")
  await expect(page.getByText("1 / 2")).toBeVisible()
  await gallery.getByRole("button", { name: "Foto berikutnya" }).click()

  // The second photo becomes the cover, and leads after a reload.
  await page.getByRole("button", { name: "Jadikan Foto Utama" }).click()
  await expect.poll(photos(item.id)).toEqual([
    ["png", true],
    ["webp", false],
  ])
  await page.reload()
  const avatar = page.getByRole("button", { name: `Lihat foto ${item.name}` })
  await expectDecoded(avatar.locator("img"))
  await expect(page.getByText("Foto Utama", { exact: true })).toBeVisible()

  // A slide opens full size.
  await gallery.getByRole("button", { name: "Lihat foto 1 dari 2 ukuran penuh" }).click()
  const preview = page.getByRole("dialog", { name: item.name })
  await expectDecoded(preview.getByRole("img", { name: `Foto ${item.name}` }))
  await page.keyboard.press("Escape")
  await expect(preview).toBeHidden()

  // The catalog list shows the cover.
  await page.goto("/products")
  await page.getByPlaceholder("Cari kode IMPA, nama, kategori produk...").fill(item.name)
  await expectDecoded(page.getByRole("row", { name: new RegExp(item.name) }).locator("img"))

  // Removing the cover passes it on; removing the last clears the gallery.
  await page.goto(`/products/${item.id}`)
  for (const left of [1, 0]) {
    await page.getByRole("button", { name: "Hapus Foto" }).click()
    const confirm = page.getByRole("dialog", { name: "Hapus foto produk?" })
    await confirm.getByRole("button", { name: "Hapus Foto" }).click()
    await expect(confirm).toBeHidden()
    await expect.poll(async () => (await photos(item.id)()).length).toBe(left)
  }
  expect(await photos(item.id)()).toEqual([])
  await expect(page.getByRole("heading", { name: "Foto Produk" })).toHaveCount(0)
  await expect(page.getByRole("button", { name: `Lihat foto ${item.name}` })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Tambah Foto (0/8)" })).toBeEnabled()
})

test("picks past the maximum are left out", async ({ page, seed }) => {
  const item = await seed.item({ label: "Produk Foto Penuh" })
  await page.goto(`/products/${item.id}`)
  const nine = Array.from({ length: 9 }, (_, i) => ({ ...blue, name: `foto-${i}.png` }))
  await page.locator('input[type="file"]').setInputFiles(nine)
  await expect(
    page.getByText("Maksimal 8 foto per produk. 1 foto tidak ditambahkan."),
  ).toBeVisible()
  await expect(page.getByRole("button", { name: "Tambah Foto (8/8)" })).toBeDisabled()
  expect((await photos(item.id)()).length).toBe(8)
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
  expect(await photos(item.id)()).toEqual([])
})

test.describe("as finance", () => {
  test.use({ session: "finance" })

  test("finance sees no photo controls", async ({ page, seed }) => {
    const item = await seed.item()
    await page.goto(`/products/${item.id}`)
    await expect(page.getByRole("heading", { name: item.name, level: 2 })).toBeVisible()
    for (const name of ["Tambah Foto", "Jadikan Foto Utama", "Hapus Foto"]) {
      await expect(page.getByRole("button", { name })).toHaveCount(0)
    }
    await expect(page.locator('input[type="file"]')).toHaveCount(0)
  })
})
