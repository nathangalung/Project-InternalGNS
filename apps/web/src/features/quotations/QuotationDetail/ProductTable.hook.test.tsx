import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { ProductRow } from "@/features/quotations/types"
import { click, mount, unmount } from "@/test/dom"
import ProductTable from "./ProductTable"

vi.mock("@/components/shared/EntityLink", () => ({
  default: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}))

const row = (over: Partial<ProductRow>): ProductRow => ({
  kode: "",
  nama: "Tali",
  qty: 1,
  satuan: "PCS",
  hargaSatuan: 0,
  profitSatuan: 0,
  ...over,
})

const linked = row({ itemId: 9, lineId: 1, vendor: "PT Tali Jaya", vendorId: 4 })
const stored = row({
  itemId: 9,
  lineId: 2,
  nama: "Baut",
  vendor: "PT Tali Jaya",
  vendorId: 4,
  productUrl: "https://toko.example/baut",
})
const noVendor = row({ itemId: 9, lineId: 3, nama: "Jangkar" })

const actions = () =>
  [...document.querySelectorAll("button")]
    .map((b) => b.textContent ?? "")
    .filter((t) => t.endsWith("Link Produk"))

afterEach(unmount)

describe("ProductTable product link action", () => {
  it("adds or changes the link of each line with a vendor", async () => {
    const onEditStoreLink = vi.fn()
    await mount(
      <ProductTable
        products={[linked, stored, noVendor]}
        showVendor
        showRequest={false}
        onEditStoreLink={onEditStoreLink}
      />,
    )
    expect(actions()).toEqual(["Tambah Link Produk", "Ubah Link Produk"])
    const add = [...document.querySelectorAll("button")].find(
      (b) => b.textContent === "Tambah Link Produk",
    )
    if (!add) throw new Error("no action")
    await click(add)
    expect(onEditStoreLink).toHaveBeenCalledWith(linked)
  })

  it("only shows the link to a role that may not change it", async () => {
    await mount(<ProductTable products={[linked, stored]} showVendor showRequest={false} />)
    expect(actions()).toEqual([])
    expect(document.querySelector('a[href="https://toko.example/baut"]')).not.toBeNull()
  })

  it("shows the vendor's store apart from the product link", async () => {
    await mount(
      <ProductTable
        products={[{ ...stored, vendorStoreUrl: "https://shop.example" }]}
        showVendor
        showRequest={false}
      />,
    )
    const labels = [...document.querySelectorAll("a")].map((a) => a.getAttribute("aria-label"))
    expect(labels).toEqual([
      "Buka toko shop.example di tab baru",
      "Buka produk di toko.example di tab baru",
    ])
    expect(document.body.textContent).toContain("Link Toko")
    expect(document.body.textContent).toContain("Link Produk")
  })

  it("offers nothing on a line whose product left the catalog", async () => {
    await mount(
      <ProductTable
        products={[{ ...linked, itemId: undefined }]}
        showVendor
        showRequest={false}
        onEditStoreLink={vi.fn()}
      />,
    )
    expect(actions()).toEqual([])
  })
})
