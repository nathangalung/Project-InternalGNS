import { useState } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { LookupFailure } from "@/lib/lookup"
import { byRole, click, mount, type, unmount } from "@/test/dom"
import { type DropdownKey, INITIAL_FORM, type ProductAddFormData } from "./helpers"
import VendorPriceCard from "./VendorPriceCard"

type Failures = {
  vendorFailure?: LookupFailure | null
  historyFailure?: LookupFailure | null
  recommendationFailure?: LookupFailure | null
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
