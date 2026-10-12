import { afterEach, describe, expect, it, vi } from "vitest"
import { unitIndex } from "@/features/units/match"
import { byRole, mount, unmount } from "@/test/dom"
import { PO_QTY_ERROR, QTY_ERROR } from "./lines"
import Step2Product from "./Step2Product"
import type { ProductItem } from "./wizard"

vi.mock("@/features/items/api")
vi.mock("./api")

const line = (jumlah: number): ProductItem => ({
  id: 1,
  itemId: 5,
  vendorId: 7,
  nama: "Rope",
  kodeImpa: "123456",
  requestedNama: "Rope",
  requestedKodeImpa: "123456",
  vendor: "PT Laut",
  jumlah,
  satuan: "PCS",
  hargaBeli: 60,
  hargaJual: 100,
})

const base = {
  deleteProduct: vi.fn(),
  setEditingProduct: vi.fn(),
  setShowProductAdd: vi.fn(),
  prodPageSize: 5,
  setProdPageSize: vi.fn(),
  prodPage: 1,
  setProdPage: vi.fn(),
  isRowDropdownOpen: false,
  setIsRowDropdownOpen: vi.fn(),
  setShowDiscountModal: vi.fn(),
  discountPct: 0,
  formatRp: String,
  summaryTotalHargaBeli: 0,
  summaryTotal: 0,
  nominalDiskon: 0,
  summarySubTotal: 0,
  summaryDpp: 0,
  summaryPpn: 0,
  summaryGrandTotal: 0,
  onImportProducts: vi.fn(),
  unitByText: unitIndex([{ id: 1, code: "PCS", aliases: [] }]),
}

function alerts(): string[] {
  return byRole("alert").map((el) => el.textContent ?? "")
}

afterEach(unmount)

describe("Step2Product qty", () => {
  it("flags a qty 0 quotation line", async () => {
    await mount(<Step2Product {...base} products={[line(0)]} />)
    expect(alerts()).toEqual([`${QTY_ERROR} Ubah produk ini sebelum menyimpan.`])
  })

  // A PO line may stay at qty 0.
  it("keeps a qty 0 PO line quiet", async () => {
    await mount(<Step2Product {...base} products={[line(0)]} allowZeroQty />)
    expect(alerts()).toEqual([])
  })

  it("still flags a negative PO line", async () => {
    await mount(<Step2Product {...base} products={[line(-1)]} allowZeroQty />)
    expect(alerts()).toEqual([`${PO_QTY_ERROR} Ubah produk ini sebelum menyimpan.`])
  })
})

// Rincian Biaya row labels.
function costLabels(): string[] {
  const title = [...document.querySelectorAll("div")].find((d) => d.textContent === "Rincian Biaya")
  const rows = title?.parentElement?.querySelectorAll(
    ":scope > div:nth-child(2) > div > span:first-child",
  )
  return [...(rows ?? [])].map((s) => s.textContent ?? "")
}

describe("Step2Product cost rows", () => {
  // The rows the quotation PDF prints.
  it("shows the PDF summary rows", async () => {
    await mount(
      <Step2Product
        {...base}
        products={[line(2)]}
        discountPct={5}
        nominalDiskon={10}
        summaryTotal={200}
        summarySubTotal={190}
        summaryGrandTotal={212.8}
      />,
    )
    expect(costLabels()).toEqual([
      "Jumlah Produk",
      "Total Harga Beli",
      "Total",
      "Diskon Produk 5%",
      "Sub Total",
      "Dengan PPN 12%",
      "DPP Nilai Lain",
      "PPN 12%",
    ])
    expect(document.body.textContent).toContain("Rp 212.8")
  })

  it("drops the discount row at 0 and the tax rows without PPN", async () => {
    await mount(<Step2Product {...base} products={[line(2)]} withPPN={false} />)
    expect(costLabels()).toEqual([
      "Jumlah Produk",
      "Total Harga Beli",
      "Total",
      "Sub Total",
      "Tanpa PPN",
    ])
  })
})
