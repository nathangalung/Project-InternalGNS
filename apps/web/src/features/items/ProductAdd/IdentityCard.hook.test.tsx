import { useState } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import Modal from "@/components/shared/Modal"
import { IMPA_ERROR, impaCodeError } from "@/lib/impa"
import type { LookupFailure } from "@/lib/lookup"
import { button, byRole, click, mount, press, type, unmount } from "@/test/dom"
import {
  type CatalogItem,
  type DropdownKey,
  INITIAL_FORM,
  type ProductAddFormData,
} from "./helpers"
import IdentityCard from "./IdentityCard"

const CATALOG: CatalogItem[] = [
  { id: 1, kode: "330212", nama: "Baut Baja" },
  { id: 2, kode: "", nama: "Mur Kuningan" },
]

type Spies = {
  onPickRequest: (item: CatalogItem) => void
  onPickProduct: (item: CatalogItem) => void
  onAddNew: () => void
  onClose: () => void
}

function Harness({
  spies,
  matches,
  failure = null,
}: {
  spies: Spies
  matches: CatalogItem[]
  failure?: LookupFailure | null
}) {
  const [form, setForm] = useState<ProductAddFormData>(INITIAL_FORM)
  const [open, setOpen] = useState<DropdownKey | null>(null)
  const change = (key: keyof ProductAddFormData, value: string) =>
    setForm((f) => ({ ...f, [key]: value }))
  return (
    <Modal title="Tambah Produk ke Quotation" onClose={spies.onClose}>
      <IdentityCard
        form={form}
        onChange={change}
        productCatalog={matches}
        productMatches={matches}
        requestMatches={matches}
        productOpen={open === "product"}
        productRequestOpen={open === "productRequest"}
        satuanOptions={["PCS", "KG"]}
        setOpenDropdown={setOpen}
        closeIfMatch={(key) => setOpen((d) => (d === key ? null : d))}
        isProductFilled={form.nama.trim().length > 0}
        isSatuanFilled={form.satuan.length > 0}
        onAddProductNew={spies.onAddNew}
        onPickProduct={(p) => {
          spies.onPickProduct(p)
          setForm((f) => ({ ...f, itemId: p.id, kodeImpa: p.kode, nama: p.nama }))
        }}
        onPickRequestSuggestion={(p) => {
          spies.onPickRequest(p)
          setForm((f) => ({
            ...f,
            requestedItemId: p.id,
            requestedKodeImpa: p.kode,
            requestedNama: p.nama,
          }))
        }}
        requestImpaError={impaCodeError(form.requestedKodeImpa)}
        requestFailure={failure}
        productFailure={failure}
      />
      <output>{JSON.stringify(form)}</output>
    </Modal>
  )
}

function spies(): Spies {
  return { onPickRequest: vi.fn(), onPickProduct: vi.fn(), onAddNew: vi.fn(), onClose: vi.fn() }
}

function field(label: string): HTMLInputElement {
  const lbl = [...document.querySelectorAll("label")].find((l) => l.textContent?.startsWith(label))
  const el = document.getElementById(lbl?.htmlFor ?? "")
  if (!(el instanceof HTMLInputElement)) throw new Error(`no field ${label}`)
  return el
}

function form(): ProductAddFormData {
  return JSON.parse(document.querySelector("output")?.textContent ?? "{}")
}

afterEach(unmount)

describe("IdentityCard pickers", () => {
  it("offers catalog rows under a heading on focus and picks one from the keyboard", async () => {
    const s = spies()
    await mount(<Harness spies={s} matches={CATALOG} />)
    const request = field("Nama Produk Request")
    await type(request, "baut")
    expect(document.body.textContent).toContain("Rekomendasi dari katalog")
    // The code and the name sit apart, a missing code as "-".
    expect(byRole("option").map((o) => o.textContent)).toEqual(["330212Baut Baja", "-Mur Kuningan"])

    await press("ArrowDown", request)
    await press("Enter", request)
    expect(s.onPickRequest).toHaveBeenCalledWith(CATALOG[0])
    expect([form().requestedKodeImpa, form().requestedNama]).toEqual(["330212", "Baut Baja"])
    expect(s.onClose).not.toHaveBeenCalled()
  })

  it("keeps the request code in its own field and names a bad one", async () => {
    await mount(<Harness spies={spies()} matches={[]} />)
    const code = field("Kode IMPA Request")
    await type(code, "19010")
    expect(code.getAttribute("aria-invalid")).toBe("true")
    expect(document.body.textContent).toContain(IMPA_ERROR)
    await type(code, "190106")
    expect(code.hasAttribute("aria-invalid")).toBe(false)
    expect(form().requestedKodeImpa).toBe("190106")
    expect(form().requestedNama).toBe("")
  })

  it("keeps free text and says so when the catalog has no match", async () => {
    await mount(<Harness spies={spies()} matches={[]} />)
    const request = field("Nama Produk Request")
    await type(request, "Permintaan khusus")
    expect(document.body.textContent).toContain(
      "Tidak ada yang cocok di katalog. Teks ini disimpan apa adanya.",
    )
    await press("Escape", request)
    expect(form().requestedNama).toBe("Permintaan khusus")
  })

  it("says a catalog lookup failed instead of claiming no match, and retries it", async () => {
    const failure = { onRetry: vi.fn(), retrying: false }
    await mount(<Harness spies={spies()} matches={[]} failure={failure} />)
    const request = field("Nama Produk Request")
    await type(request, "baut")
    expect(byRole("alert").map((a) => a.textContent)).toEqual([
      "Gagal memuat katalog produk.Coba Lagi",
    ])
    expect(document.body.textContent).not.toContain("Tidak ada rekomendasi")
    await click(button("Coba Lagi"))
    expect(failure.onRetry).toHaveBeenCalledTimes(1)
    await press("Escape", request)
    expect(form().requestedNama).toBe("baut")

    await type(field("Nama Produk Offer"), "mur")
    expect(document.body.textContent).toContain("Gagal memuat katalog produk.")
    expect(document.body.textContent).not.toContain("Tidak ada hasil")
    // A product outside the catalog can still be added.
    expect(button("Tambah Produk Baru")).toBeTruthy()
  })

  it("picks an offer with the pointer and reaches Tambah Produk Baru", async () => {
    const s = spies()
    await mount(<Harness spies={s} matches={CATALOG} />)
    await type(field("Nama Produk Offer"), "mur")
    await click(byRole("option")[1])
    expect(s.onPickProduct).toHaveBeenCalledWith(CATALOG[1])
    expect([form().kodeImpa, form().nama]).toEqual(["", "Mur Kuningan"])
    expect(field("Kode IMPA Offer").value).toBe("-")

    await type(field("Nama Produk Offer"), "zz")
    const addNew = [...document.querySelectorAll("button")].find(
      (b) => b.textContent === "Tambah Produk Baru",
    )
    addNew?.click()
    expect(s.onAddNew).toHaveBeenCalled()
  })

  it("unlocks the unit select once an offer exists and picks from the keyboard", async () => {
    await mount(<Harness spies={spies()} matches={CATALOG} />)
    const [unit] = byRole("combobox", "Satuan *")
    expect(unit.hasAttribute("data-disabled")).toBe(true)
    expect(unit.textContent).toBe("Pilih satuan")

    await type(field("Nama Produk Offer"), "Barang baru")
    await press("Escape", field("Nama Produk Offer"))
    unit.focus()
    await press("ArrowDown", unit)
    await press("ArrowDown")
    await press("Enter")
    expect(form().satuan).toBe("KG")
  })
})
