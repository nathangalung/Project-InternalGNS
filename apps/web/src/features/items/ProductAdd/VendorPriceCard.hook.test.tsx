import { useState } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { LookupFailure } from "@/lib/lookup"
import { button, byRole, click, mount, type, unmount } from "@/test/dom"
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
  onEditStoreLink?: () => void
}

function Harness(failures: Failures) {
  const [form, setForm] = useState<ProductAddFormData>({ ...INITIAL_FORM, jumlahProduk: "2" })
  const [open, setOpen] = useState<DropdownKey | null>(null)
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

describe("VendorPriceCard store link", () => {
  const linked: VendorOption = {
    nama: "PT Tali Jaya",
    harga: 1000,
    vendorId: 4,
    vendorProductId: 7,
  }
  const storeLink = () => document.querySelector('a[target="_blank"]')

  it("offers Tambah Link Toko beside a linked vendor without one", async () => {
    const onEditStoreLink = vi.fn()
    await mount(<Harness exactVendor={linked} onEditStoreLink={onEditStoreLink} />)
    expect(storeLink()).toBeNull()
    await click(button("Tambah Link Toko"))
    expect(onEditStoreLink).toHaveBeenCalledTimes(1)
  })

  it("shows the stored link and offers to change it", async () => {
    const onEditStoreLink = vi.fn()
    const withLink = { ...linked, storeUrl: "https://toko.example/tali" }
    await mount(<Harness exactVendor={withLink} onEditStoreLink={onEditStoreLink} />)
    expect(storeLink()?.getAttribute("href")).toBe("https://toko.example/tali")
    await click(button("Ubah Link Toko"))
    expect(onEditStoreLink).toHaveBeenCalledTimes(1)
  })

  it("only shows the link when the role may not change it", async () => {
    await mount(<Harness exactVendor={{ ...linked, storeUrl: "https://toko.example/tali" }} />)
    expect(storeLink()).not.toBeNull()
    expect(document.body.textContent).not.toContain("Link Toko")
  })
})
