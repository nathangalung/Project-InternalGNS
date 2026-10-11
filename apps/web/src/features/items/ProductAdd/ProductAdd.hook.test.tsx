import { QueryClientProvider } from "@tanstack/react-query"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import * as itemsApi from "@/features/items/api"
import * as unitsApi from "@/features/units/api"
import { ApiError } from "@/lib/api-client"
import { button, byRole, click, mount, settle, type, unmount } from "@/test/dom"
import { problem } from "@/test/problem"
import { throwingQueryClient } from "@/test/query"
import type { ItemImpaHolder, ItemImpaTakenProblem, ItemRow, ItemVendorRow } from "@/types/api"
import ProductAdd from "."
import type { ProductAddInitialData } from "./helpers"

vi.mock("@/features/items/api")
vi.mock("@/features/vendors/api")
vi.mock("@/features/units/api")

const items = vi.mocked(itemsApi)

const STAMP = { createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" }
const ACTIVE: ItemRow = { id: 1, name: "Baut Baja", impaCode: "330212", isActive: true, ...STAMP }
const RETIRED: ItemRow = { id: 2, name: "Ampelas Lama", isActive: false, ...STAMP }

function field(label: string): HTMLInputElement {
  const lbl = [...document.querySelectorAll("label")].find((l) => l.textContent?.startsWith(label))
  const el = document.getElementById(lbl?.htmlFor ?? "")
  if (!(el instanceof HTMLInputElement)) throw new Error(`no field ${label}`)
  return el
}

// Field whose label is exactly this.
function exactField(label: string): HTMLInputElement {
  const lbl = [...document.querySelectorAll("label")].find((l) => l.textContent?.trim() === label)
  const el = document.getElementById(lbl?.htmlFor ?? "")
  if (!(el instanceof HTMLInputElement)) throw new Error(`no field ${label}`)
  return el
}

async function open() {
  await mount(
    <QueryClientProvider client={throwingQueryClient()}>
      <ProductAdd open onOpenChange={vi.fn()} onSuccess={vi.fn()} />
    </QueryClientProvider>,
  )
  await settle()
}

async function focusProduct() {
  const input = field("Kode IMPA/Nama Produk *")
  input.focus()
  input.dispatchEvent(new FocusEvent("focusin", { bubbles: true }))
  await settle()
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(unitsApi.list).mockResolvedValue([])
  // The server filters as the real list does.
  items.list.mockImplementation(async (params = {}) => {
    const rows = params.isActive ? [ACTIVE] : [ACTIVE, RETIRED]
    return { rows, total: rows.length }
  })
})
afterEach(unmount)

describe("ProductAdd closed", () => {
  // The edit pages keep it mounted.
  //
  // A closed dialog holds no queries, so a live save's invalidation
  // refetches nothing behind it.
  it("loads nothing while closed", async () => {
    await mount(
      <QueryClientProvider client={throwingQueryClient()}>
        <ProductAdd open={false} onOpenChange={vi.fn()} onSuccess={vi.fn()} />
      </QueryClientProvider>,
    )
    await settle()
    expect(items.list).not.toHaveBeenCalled()
    expect(vi.mocked(unitsApi.list)).not.toHaveBeenCalled()
    expect(byRole("dialog")).toHaveLength(0)
  })
})

describe("ProductAdd catalog", () => {
  it("never offers a deactivated product for a new line", async () => {
    await open()
    await focusProduct()
    const offered = byRole("option").map((o) => o.textContent)
    expect(offered).toContain("330212 - Baut Baja")
    expect(offered).not.toContain("Ampelas Lama")
  })

  it("shows a failed catalog beside the field and keeps the dialog", async () => {
    items.list.mockRejectedValue(new ApiError(502, null, ""))
    await open()
    await focusProduct()
    expect(document.body.textContent).toContain("Gagal memuat katalog produk.")
    expect(byRole("dialog")).toHaveLength(1)
  })
})

describe("ProductAdd store link", () => {
  const line: ProductAddInitialData = {
    kodeImpa: "330212",
    nama: "Baut Baja",
    jumlah: 2,
    satuan: "PCS",
    vendor: "PT Tali Jaya",
    hargaBeli: 1000,
    hargaJual: 1500,
    itemId: 1,
    vendorId: 4,
    vendorProductId: 7,
  }
  const link: ItemVendorRow = {
    vendorProductId: 7,
    vendorId: 4,
    vendorName: "PT Tali Jaya",
    costPrice: "1000.00",
  }

  async function openLine(initialData: ProductAddInitialData, storeLinks: boolean) {
    await mount(
      <QueryClientProvider client={throwingQueryClient()}>
        <ProductAdd
          open
          onOpenChange={vi.fn()}
          onSuccess={vi.fn()}
          initialData={initialData}
          storeLinks={storeLinks}
        />
      </QueryClientProvider>,
    )
    await settle()
  }

  const hasAction = () =>
    [...document.querySelectorAll("button")].some((b) => b.textContent === "Tambah Link Toko")

  it("adds the store link of the line's linked vendor from the dialog", async () => {
    items.listVendors.mockResolvedValue([link])
    items.addVendor.mockResolvedValue({ ...link, productUrl: "https://toko.example/baut" })
    await openLine(line, true)
    await click(button("Tambah Link Toko"))
    expect(byRole("dialog").map((d) => d.querySelector("h2")?.textContent)).toContain(
      "Tambah Link Toko",
    )
    const input = document.querySelector<HTMLInputElement>('input[type="url"]')
    if (!input) throw new Error("no url input")
    await type(input, "https://toko.example/baut")
    await click(button("Simpan"))
    await settle()
    expect(items.addVendor).toHaveBeenCalledWith(1, {
      vendorId: 4,
      productUrl: "https://toko.example/baut",
    })
  })

  it("offers nothing to a role that may not write the catalog", async () => {
    items.listVendors.mockResolvedValue([link])
    await openLine(line, false)
    expect(hasAction()).toBe(false)
  })

  // A URL alone would create the link at harga beli 0.
  it("offers nothing for a vendor the product is not linked to yet", async () => {
    items.listVendors.mockResolvedValue([])
    await openLine({ ...line, itemId: 2, vendorProductId: undefined }, true)
    expect(hasAction()).toBe(false)
  })
})

describe("ProductAdd taken IMPA code", () => {
  const holder: ItemImpaHolder = {
    id: 1,
    name: "BAUT BJ",
    impaCode: "330212",
    defaultUnitId: 5,
    renamable: true,
  }
  const RENAMED_TO = "Baut Baja M10"

  function takenBy(h: ItemImpaHolder): ApiError {
    const fields = { impaCode: "Kode IMPA ini sudah dipakai produk aktif lain." }
    const body: ItemImpaTakenProblem = {
      ...problem(422, { fields, code: "impa_taken" }),
      impaHolder: h,
    }
    return new ApiError(422, body, fields.impaCode)
  }

  // Tambah Produk Baru with the holder's code.
  async function createTaken(h: ItemImpaHolder, storeLinks: boolean) {
    items.create.mockRejectedValue(takenBy(h))
    items.recommend.mockResolvedValue([])
    items.listVendors.mockResolvedValue([])
    items.priceHistory.mockResolvedValue([])
    await mount(
      <QueryClientProvider client={throwingQueryClient()}>
        <ProductAdd open onOpenChange={vi.fn()} onSuccess={vi.fn()} storeLinks={storeLinks} />
      </QueryClientProvider>,
    )
    await settle()
    await focusProduct()
    await click(button("Tambah Produk Baru"))
    await type(exactField("Nama Produk *"), RENAMED_TO)
    await type(exactField("Kode IMPA"), h.impaCode)
    await click(button("Tambahkan"))
    await settle()
  }

  const offer = () => field("Kode IMPA/Nama Produk *").value
  const hasButton = (name: string) =>
    [...document.querySelectorAll("button")].some((b) => b.textContent === name)
  const renameLabel = `Ganti Nama Jadi “${RENAMED_TO}”`

  it("names the holder under the code", async () => {
    await createTaken(holder, true)
    expect(document.body.textContent).toContain("Kode IMPA ini sudah dipakai “BAUT BJ”.")
    expect(hasButton("Pakai Produk Ini")).toBe(true)
  })

  it("picks the holder as the offer, as a search pick does", async () => {
    await createTaken(holder, true)
    await click(button("Pakai Produk Ini"))
    await settle()
    expect(byRole("dialog").map((d) => d.querySelector("h2")?.textContent)).not.toContain(
      "Tambah Produk Baru",
    )
    expect(offer()).toBe("330212 - BAUT BJ")
    expect(items.recommend).toHaveBeenCalledWith([1], undefined)
    expect(items.rename).not.toHaveBeenCalled()
  })

  it("renames the holder to the typed name, then picks it", async () => {
    items.rename.mockResolvedValue({
      ...ACTIVE,
      name: RENAMED_TO,
      impaCode: "330212",
      defaultUnitId: 5,
    })
    await createTaken(holder, true)
    await click(button(renameLabel))
    await settle()
    expect(items.rename).toHaveBeenCalledWith(1, RENAMED_TO)
    expect(offer()).toBe(`330212 - ${RENAMED_TO}`)
    expect(items.recommend).toHaveBeenCalledWith([1], undefined)
  })

  it("keeps the dialog with the reason when the rename is refused", async () => {
    const detail =
      "Nama produk ini tidak bisa diganti karena sudah dipakai di quotation terkirim, PO, atau invoice."
    items.rename.mockRejectedValue(new ApiError(409, problem(409, { detail }), detail))
    await createTaken(holder, true)
    await click(button(renameLabel))
    await settle()
    expect(document.body.textContent).toContain(detail)
    expect(hasButton("Pakai Produk Ini")).toBe(true)
  })

  it.each<[string, ItemImpaHolder, boolean, boolean, boolean]>([
    ["a catalog writer, unfiled holder", holder, true, true, false],
    ["a catalog writer, filed holder", { ...holder, renamable: false }, true, false, true],
    ["a role that may not write the catalog", holder, false, false, false],
  ])("offers the rename to %s", async (_name, h, storeLinks, rename, reason) => {
    await createTaken(h, storeLinks)
    expect(hasButton("Pakai Produk Ini")).toBe(true)
    expect(hasButton(renameLabel)).toBe(rename)
    expect(document.body.textContent?.includes("tidak bisa diganti")).toBe(reason)
  })

  it("drops the holder once the code changes", async () => {
    await createTaken(holder, true)
    await type(exactField("Kode IMPA"), "330213")
    expect(hasButton("Pakai Produk Ini")).toBe(false)
  })
})
