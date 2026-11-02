import { useState } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { LookupFailure } from "@/lib/lookup"
import { byRole, click, mount, type, unmount } from "@/test/dom"
import {
  type DropdownKey,
  INITIAL_FORM,
  type ProductAddFormData,
  type VendorOption,
} from "./helpers"
import VendorPriceCard from "./VendorPriceCard"

type Failures = {
  vendorFailure?: LookupFailure | null
  historyFailure?: LookupFailure | null
  recommendationFailure?: LookupFailure | null
  exactVendor?: VendorOption
  linkUrl?: string
  onLinkChange?: (url: string) => void
  onForm?: (form: ProductAddFormData) => void
}

function Harness({ onForm, ...failures }: Failures) {
  const [form, setForm] = useState<ProductAddFormData>({ ...INITIAL_FORM, jumlahProduk: "2" })
  const [open, setOpen] = useState<DropdownKey | null>(null)
  onForm?.(form)
  return (
    <VendorPriceCard
      form={form}
      onChange={(key, value) => setForm((f) => ({ ...f, [key]: value }))}
      onPickVendor={vi.fn()}
      onPickHistoris={vi.fn()}
      vendorMatches={[]}
      vendorOpen={open === "vendor"}
      historisOptions={[]}
      setOpenDropdown={setOpen}
      closeIfMatch={(key) => setOpen((d) => (d === key ? null : d))}
      isJumlahFilled
      isVendorFilled
      profit={0}
      profitPct="0.00"
      onAddVendorNew={vi.fn()}
      {...failures}
    />
  )
}

const failure = (): LookupFailure => ({ onRetry: vi.fn(), retrying: false })
const alerts = () => byRole("alert").map((a) => a.textContent)

function vendorField(): HTMLInputElement {
  const lbl = [...document.querySelectorAll("label")].find((l) =>
    l.textContent?.startsWith("Nama Vendor"),
  )
  const el = document.getElementById(lbl?.htmlFor ?? "")
  if (!(el instanceof HTMLInputElement)) throw new Error("no vendor field")
  return el
}

afterEach(unmount)

describe("VendorPriceCard lookups", () => {
  it("shows nothing extra while every lookup is fine", async () => {
    await mount(<Harness />)
    expect(alerts()).toEqual([])
  })

  it("says the vendor search failed instead of no match, and retries it", async () => {
    const vendorFailure = failure()
    await mount(<Harness vendorFailure={vendorFailure} />)
    await type(vendorField(), "sinar")
    expect(alerts()).toEqual(["Gagal memuat vendor.Coba Lagi"])
    expect(document.body.textContent).not.toContain("Tidak ada hasil")
    await click(byRole("alert")[0].querySelector("button") as HTMLButtonElement)
    expect(vendorFailure.onRetry).toHaveBeenCalledTimes(1)
  })

  it("names a failed price history and a failed recommendation", async () => {
    const historyFailure = failure()
    const recommendationFailure = failure()
    await mount(
      <Harness historyFailure={historyFailure} recommendationFailure={recommendationFailure} />,
    )
    expect(alerts()).toEqual([
      "Gagal memuat rekomendasi vendor dan harga.Coba Lagi",
      "Gagal memuat riwayat harga jual.Coba Lagi",
    ])
    const [rec, history] = byRole("alert").map((a) => a.querySelector("button") as HTMLElement)
    await click(rec)
    await click(history)
    expect(recommendationFailure.onRetry).toHaveBeenCalledTimes(1)
    expect(historyFailure.onRetry).toHaveBeenCalledTimes(1)
  })
})

// Field whose label starts with this.
function labelled(label: string): HTMLInputElement {
  const lbl = [...document.querySelectorAll("label")].find((l) => l.textContent?.startsWith(label))
  const el = document.getElementById(lbl?.htmlFor ?? "")
  if (!(el instanceof HTMLInputElement)) throw new Error(`no field ${label}`)
  return el
}

describe("VendorPriceCard prices", () => {
  // Dots group thousands, a comma starts the sen.
  it.each([
    ["Harga Beli Satuan", "hargaBeli", "200.000", "200000", "200.000"],
    ["Harga Jual Satuan", "hargaJual", "200.000", "200000", "200.000"],
    ["Harga Beli Satuan", "hargaBeli", "200.000,50", "200000.50", "200.000,50"],
    ["Harga Jual Satuan", "hargaJual", "Rp 200.000", "200000", "200.000"],
  ] as const)("%s reads %s as %s", async (label, key, typed, kept, shown) => {
    let form = INITIAL_FORM
    await mount(<Harness onForm={(f) => (form = f)} />)
    await type(labelled(label), typed)
    expect(form[key]).toBe(kept)
    expect(labelled(label).value).toBe(shown)
  })
})

describe("VendorPriceCard product link", () => {
  const linked: VendorOption = {
    nama: "PT Tali Jaya",
    harga: 1000,
    vendorId: 4,
    vendorProductId: 7,
  }
  const anchor = () => document.querySelector('a[target="_blank"]')
  const hasLinkField = () =>
    [...document.querySelectorAll("label")].some((l) => l.textContent?.startsWith("Link Produk"))

  it("takes the link beside the picked vendor", async () => {
    const onLinkChange = vi.fn()
    await mount(<Harness exactVendor={linked} linkUrl="" onLinkChange={onLinkChange} />)
    await type(labelled("Link Produk"), "https://toko.example/tali")
    expect(onLinkChange).toHaveBeenLastCalledWith("https://toko.example/tali")
  })

  it("shows the stored link in the field, ready to change", async () => {
    const stored = { ...linked, storeUrl: "https://toko.example/tali" }
    await mount(
      <Harness exactVendor={stored} linkUrl="https://toko.example/tali" onLinkChange={vi.fn()} />,
    )
    expect(labelled("Link Produk").value).toBe("https://toko.example/tali")
    expect(anchor()?.getAttribute("href")).toBe("https://toko.example/tali")
  })

  it("names a link that is not http or https", async () => {
    await mount(
      <Harness exactVendor={linked} linkUrl="javascript:alert(1)" onLinkChange={vi.fn()} />,
    )
    expect(document.body.textContent).toContain("Link produk harus diawali http:// atau https://.")
    expect(labelled("Link Produk").getAttribute("aria-invalid")).toBe("true")
  })

  // The save links a new vendor together with its link.
  it("takes a link for a vendor the product has no link to yet", async () => {
    const fresh: VendorOption = { nama: "PT Baru", harga: 0, vendorId: 9 }
    await mount(<Harness exactVendor={fresh} linkUrl="" onLinkChange={vi.fn()} />)
    expect(hasLinkField()).toBe(true)
  })

  it("asks for no link before a vendor is picked", async () => {
    await mount(<Harness linkUrl="" onLinkChange={vi.fn()} />)
    expect(hasLinkField()).toBe(false)
  })

  it("only shows the link when the role may not change it", async () => {
    await mount(<Harness exactVendor={{ ...linked, storeUrl: "https://toko.example/tali" }} />)
    expect(anchor()).not.toBeNull()
    expect(hasLinkField()).toBe(false)
  })
})
