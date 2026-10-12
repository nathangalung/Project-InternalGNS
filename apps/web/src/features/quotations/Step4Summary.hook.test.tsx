import { afterEach, describe, expect, it, vi } from "vitest"
import { mount, type, unmount } from "@/test/dom"
import Step4Summary from "./Step4Summary"

const totals = {
  summaryTotalProdukQty: 0,
  summaryTotalHargaBeli: 0,
  summaryTotal: 0,
  nominalDiskon: 0,
  summarySubTotal: 0,
  summaryDpp: 0,
  summaryPpn: 0,
  summaryProfit: 0,
  summaryGrandTotal: 0,
}

const base = {
  shippingAddress: "",
  shippingTime: "",
  shippingCost: "",
  products: [],
  discountPct: 0,
  formatRp: String,
  ...totals,
}

function text(): string {
  return document.body.textContent ?? ""
}

afterEach(unmount)

describe("Step4Summary terms", () => {
  it("asks a quotation for its payment and validity days", async () => {
    const terms = {
      jatuhTempo: "",
      setJatuhTempo: vi.fn(),
      berlakuSampai: "",
      setBerlakuSampai: vi.fn(),
      clientRefNo: "",
      setClientRefNo: vi.fn(),
    }
    await mount(<Step4Summary {...base} terms={terms} />)
    expect(text()).toContain("Tenggat Waktu Penawaran")
    expect(text()).toContain("Isi jatuh tempo pembayaran dan masa berlaku")
  })

  // A PO keeps its quotation's terms.
  it("shows no terms when none are given", async () => {
    await mount(<Step4Summary {...base} />)
    expect(text()).not.toContain("Tenggat Waktu Penawaran")
    expect(text()).not.toContain("JATUH TEMPO PEMBAYARAN")
    expect(text()).not.toContain("wajib diisi")
    expect(document.querySelector("main > div > div")?.textContent).toContain("Ringkasan Klien")
  })

  it("still lists line problems without terms", async () => {
    await mount(<Step4Summary {...base} unknownUnitCount={2} />)
    expect(text()).not.toContain("Tenggat Waktu Penawaran")
    expect(text()).toContain("2 produk memiliki satuan yang tidak dikenal")
  })
})

describe("Step4Summary client reference", () => {
  const terms = {
    jatuhTempo: "30",
    setJatuhTempo: vi.fn(),
    berlakuSampai: "14",
    setBerlakuSampai: vi.fn(),
    clientRefNo: "",
    setClientRefNo: vi.fn(),
  }
  const client = {
    id: "7",
    name: "PT Laut Biru",
    narahubung: "Budi",
    country: "ID",
    initials: "LB",
  }
  const refInput = () => document.querySelector<HTMLInputElement>('input[maxlength="100"]')

  // Printed as Your Ref No.; the client number never stands in.
  it("takes the client's own reference", async () => {
    await mount(<Step4Summary {...base} terms={terms} currentClient={client} />)
    const input = refInput()
    if (!input) throw new Error("no reference input")
    expect(input.labels?.[0]?.textContent).toContain("No. Referensi Klien")
    expect(text()).not.toContain("Reference Number")
    await type(input, "V-26-2405-002-E")
    expect(terms.setClientRefNo).toHaveBeenCalledWith("V-26-2405-002-E")
  })

  it("is read-only while another user holds the header", async () => {
    await mount(<Step4Summary {...base} terms={terms} readOnly />)
    expect(refInput()?.disabled).toBe(true)
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

describe("Step4Summary cost rows", () => {
  // Shipping sits in Total, as on the PDF, with no row of its own.
  it("shows the PDF summary rows", async () => {
    await mount(<Step4Summary {...base} shippingCost="50" discountPct={2.5} nominalDiskon={5} />)
    expect(costLabels()).toEqual([
      "Jumlah Produk",
      "Total Harga Beli",
      "Total",
      "Diskon Produk 2,5%",
      "Sub Total",
      "DPP Nilai Lain",
      "PPN 12%",
    ])
  })

  it("drops the discount row at 0 and shows Tanpa PPN", async () => {
    await mount(<Step4Summary {...base} withPPN={false} />)
    expect(costLabels()).toEqual(["Jumlah Produk", "Total Harga Beli", "Total", "Sub Total", "PPN"])
  })
})
