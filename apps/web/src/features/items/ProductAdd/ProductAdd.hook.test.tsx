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
  const input = field("Nama Produk Offer")
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
    expect(offered).toContain("330212Baut Baja")
    expect(offered.some((o) => o?.includes("Ampelas Lama"))).toBe(false)
  })

  it("shows a failed catalog beside the field and keeps the dialog", async () => {
    items.list.mockRejectedValue(new ApiError(502, null, ""))
    await open()
    await focusProduct()
    expect(document.body.textContent).toContain("Gagal memuat katalog produk.")
    expect(byRole("dialog")).toHaveLength(1)
  })
})

describe("ProductAdd saved line", () => {
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

  type Opts = { storeLinks?: boolean; purchaseOnly?: boolean; pricing?: boolean; po?: boolean }

  async function openLine(initialData: ProductAddInitialData, opts: Opts = {}) {
    const onSuccess = vi.fn()
    items.priceHistory.mockResolvedValue([])
    await mount(
      <QueryClientProvider client={throwingQueryClient()}>
        <ProductAdd
          open
          onOpenChange={vi.fn()}
          onSuccess={onSuccess}
          initialData={initialData}
          storeLinks={opts.storeLinks}
          purchaseOnly={opts.purchaseOnly}
          pricing={opts.pricing}
          docKind={opts.po ? "po" : "quotation"}
          allowIncomplete={!opts.po}
        />
      </QueryClientProvider>,
    )
    await settle()
    return onSuccess
  }

  // Saves through the price confirmation when it asks.
  async function save(): Promise<void> {
    await click(button("Simpan Perubahan"))
    if ([...document.querySelectorAll("button")].some((b) => b.textContent === "Ya, Ubah")) {
      await click(button("Ya, Ubah"))
    }
  }

  const saveButton = () => button("Simpan Perubahan") as HTMLButtonElement
  const hasLinkField = () =>
    [...document.querySelectorAll("label")].some((l) => l.textContent?.startsWith("Link Produk"))

  it("carries a typed product link with the line", async () => {
    items.listVendors.mockResolvedValue([link])
    const onSuccess = await openLine(line, { storeLinks: true })
    await type(field("Link Produk"), " https://toko.example/baut ")
    await save()
    expect(onSuccess).toHaveBeenCalledWith(
      expect.objectContaining({ vendorId: 4, productUrl: "https://toko.example/baut" }),
    )
    expect(items.addVendor).not.toHaveBeenCalled()
  })

  it("shows the stored link and sends nothing when it is left alone", async () => {
    items.listVendors.mockResolvedValue([{ ...link, productUrl: "https://toko.example/lama" }])
    const onSuccess = await openLine(line, { storeLinks: true })
    expect(field("Link Produk").value).toBe("https://toko.example/lama")
    await save()
    expect(onSuccess.mock.calls[0][0].productUrl).toBeUndefined()
  })

  it("clears a stored link when the field is emptied", async () => {
    items.listVendors.mockResolvedValue([{ ...link, productUrl: "https://toko.example/lama" }])
    const onSuccess = await openLine(line, { storeLinks: true })
    await type(field("Link Produk"), "")
    await save()
    expect(onSuccess.mock.calls[0][0].productUrl).toBe("")
  })

  it("holds the save while the link is not a web address", async () => {
    items.listVendors.mockResolvedValue([link])
    await openLine(line, { storeLinks: true })
    await type(field("Link Produk"), "javascript:alert(1)")
    expect(saveButton().disabled).toBe(true)
  })

  // The save links the vendor and sets its link at once.
  it("takes a link for a vendor the product is not linked to yet", async () => {
    items.listVendors.mockResolvedValue([])
    const onSuccess = await openLine(
      { ...line, itemId: 2, vendorProductId: undefined },
      { storeLinks: true },
    )
    await type(field("Link Produk"), "https://toko.example/baru")
    await save()
    expect(onSuccess).toHaveBeenCalledWith(
      expect.objectContaining({ vendorId: 4, productUrl: "https://toko.example/baru" }),
    )
  })

  it("asks no link of a role that may not write the catalog", async () => {
    items.listVendors.mockResolvedValue([link])
    const onSuccess = await openLine(line, { storeLinks: false })
    expect(hasLinkField()).toBe(false)
    await save()
    expect(onSuccess.mock.calls[0][0].productUrl).toBeUndefined()
  })

  // The input reads Indonesian.
  it("saves typed prices as rupiah, not as decimals", async () => {
    items.listVendors.mockResolvedValue([link])
    const onSuccess = await openLine(line)
    await type(field("Harga Beli Satuan"), "200.000")
    await type(field("Harga Jual Satuan"), "250.000,50")
    await save()
    expect(onSuccess).toHaveBeenCalledWith(
      expect.objectContaining({ hargaBeli: "200000", hargaJual: "250000.50" }),
    )
  })

  // A stored PO line may have no unit.
  // The role cannot pick one, so harga beli must not wait for it.
  it("lets a purchase-only role change harga beli on a line with no unit", async () => {
    items.listVendors.mockResolvedValue([link])
    const onSuccess = await openLine(
      { ...line, satuan: "" },
      { purchaseOnly: true, pricing: false, po: true },
    )
    const beli = field("Harga Beli Satuan")
    expect(beli.disabled).toBe(false)
    expect(field("Nama Vendor").disabled).toBe(false)
    await type(beli, "1.200")
    await save()
    expect(onSuccess).toHaveBeenCalledWith(expect.objectContaining({ hargaBeli: "1200" }))
  })
})

describe("ProductAdd taken IMPA code", () => {
  const holder: ItemImpaHolder = {
    id: 1,
    name: "BAUT BJ",
    impaCode: "330212",
    defaultUnitId: 5,
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

  const offer = () => field("Nama Produk Offer").value
  const offerCode = () => field("Kode IMPA Offer").value
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
    expect([offerCode(), offer()]).toEqual(["330212", "BAUT BJ"])
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
    expect([offerCode(), offer()]).toEqual(["330212", RENAMED_TO])
    expect(items.recommend).toHaveBeenCalledWith([1], undefined)
  })

  it("keeps the dialog with the reason when the rename fails", async () => {
    items.rename.mockRejectedValue(new TypeError("Failed to fetch"))
    await createTaken(holder, true)
    await click(button(renameLabel))
    await settle()
    expect(document.body.textContent).toContain("Gagal mengganti nama produk.")
    expect(hasButton("Pakai Produk Ini")).toBe(true)
  })

  // Filed documents keep their own copy of the name.
  it.each<[string, boolean, boolean]>([
    ["a catalog writer", true, true],
    ["a role that may not write the catalog", false, false],
  ])("offers the rename to %s", async (_name, storeLinks, rename) => {
    await createTaken(holder, storeLinks)
    expect(hasButton("Pakai Produk Ini")).toBe(true)
    expect(hasButton(renameLabel)).toBe(rename)
  })

  it("drops the holder once the code changes", async () => {
    await createTaken(holder, true)
    await type(exactField("Kode IMPA"), "330213")
    expect(hasButton("Pakai Produk Ini")).toBe(false)
  })
})
