import { QueryClientProvider } from "@tanstack/react-query"
import { act, useState } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import * as itemsApi from "@/features/items/api"
import type { VendorListParams } from "@/features/vendors/api"
import * as vendorsApi from "@/features/vendors/api"
import { queryKeys } from "@/lib/query-keys"
import { button, byRole, click, mount, press, settle, type, unmount } from "@/test/dom"
import { testQueryClient } from "@/test/query"
import type { ItemVendorRow } from "@/types/api"
import AddVendorToItemModal from "./AddVendorToItemModal"

vi.mock("@/features/vendors/api")
vi.mock("@/features/items/api")

// Params the vendor search sends.
const noHits: VendorListParams = { q: "zzz", isActive: true, limit: 10 }

// Outer modal, no vendor hits.
function Harness({ edit }: { edit?: ItemVendorRow }) {
  const [open, setOpen] = useState(true)
  const [qc] = useState(() => {
    const client = testQueryClient()
    client.setQueryData(queryKeys.vendors.list(noHits), {
      rows: [],
      total: 0,
    })
    return client
  })
  return (
    <QueryClientProvider client={qc}>
      <AddVendorToItemModal open={open} itemId={1} onOpenChange={setOpen} edit={edit} />
    </QueryClientProvider>
  )
}

afterEach(unmount)

const dialogTitles = () => byRole("dialog").map((d) => d.querySelector("h2")?.textContent)

function vendorInput(): HTMLInputElement {
  const el = document.querySelector<HTMLInputElement>('input[placeholder="Cari vendor aktif..."]')
  if (!el) throw new Error("no vendor input")
  return el
}

function addNewButton(): HTMLButtonElement {
  const el = [...document.querySelectorAll("button")].find((b) =>
    b.textContent?.includes("Tambah Vendor Baru"),
  )
  if (!el) throw new Error("no add-new button")
  return el
}

describe("AddVendorToItemModal", () => {
  it("closes the vendor list when the nested vendor modal opens", async () => {
    await mount(<Harness />)
    await type(vendorInput(), "zzz")
    await settle(300)
    expect(document.body.textContent).toContain("tidak ditemukan")

    // A real mousedown focuses the button.
    const addNew = addNewButton()
    await act(async () => addNew.focus())
    await click(addNew)
    await settle(50)
    expect(dialogTitles()).toEqual(["Tambah Vendor Terkait", "Tambah Vendor Baru"])
    expect(byRole("listbox")).toHaveLength(0)
    expect(document.body.textContent).not.toContain("tidak ditemukan")
    expect(vendorInput().getAttribute("aria-expanded")).toBe("false")

    // One Escape per modal.
    await press("Escape")
    expect(dialogTitles()).toEqual(["Tambah Vendor Terkait"])
    expect(document.activeElement).toBe(vendorInput())
    expect(vendorInput().value).toBe("zzz")

    await press("Escape")
    expect(byRole("dialog")).toHaveLength(0)
  })

  it("says the vendor search failed instead of offering a new vendor", async () => {
    vi.mocked(vendorsApi.list).mockRejectedValue(new Error("502"))
    await mount(<Harness />)
    await type(vendorInput(), "sinar")
    // Debounce, then the failed search.
    await vi.waitFor(async () => {
      await settle(50)
      expect(document.body.textContent).toContain("Gagal memuat vendor.")
    })
    expect(document.body.textContent).not.toContain("tidak ditemukan")
  })
})

describe("AddVendorToItemModal edit", () => {
  const stored: ItemVendorRow = {
    vendorProductId: 5,
    vendorId: 7,
    vendorName: "PT Laut",
    costPrice: "150000.50",
    productUrl: "https://toko.example/rope",
  }

  function input(id: string): HTMLInputElement {
    const label = [...document.querySelectorAll("label")].find((l) => l.textContent?.startsWith(id))
    const el = document.getElementById(label?.htmlFor ?? "")
    if (!(el instanceof HTMLInputElement)) throw new Error(`no input ${id}`)
    return el
  }

  it("starts from the stored link with the vendor fixed", async () => {
    await mount(<Harness edit={stored} />)
    expect(dialogTitles()).toEqual(["Ubah Vendor Terkait"])
    expect(input("Nama Vendor").value).toBe("PT Laut")
    expect(input("Nama Vendor").readOnly).toBe(true)
    expect(input("Harga Beli").value).toBe("150.000")
    expect(input("Link Toko").value).toBe("https://toko.example/rope")
  })

  it("refuses a link that is not http or https", async () => {
    await mount(<Harness edit={stored} />)
    await type(input("Link Toko"), "javascript:alert(1)")
    expect(document.body.textContent).toContain("Link toko harus diawali http:// atau https://.")
    expect(button("Simpan").disabled).toBe(true)
  })

  it("leaves the stored price out and clears the link with null", async () => {
    vi.mocked(itemsApi.addVendor).mockResolvedValue(stored)
    await mount(<Harness edit={stored} />)
    await type(input("Link Toko"), "  ")
    await click(button("Simpan"))
    expect(itemsApi.addVendor).toHaveBeenCalledWith(1, {
      vendorId: 7,
      costPrice: undefined,
      productUrl: null,
    })
  })

  it("sends a typed price as typed", async () => {
    vi.mocked(itemsApi.addVendor).mockResolvedValue(stored)
    await mount(<Harness edit={stored} />)
    await type(input("Harga Beli"), "175000")
    await click(button("Simpan"))
    expect(itemsApi.addVendor).toHaveBeenLastCalledWith(1, {
      vendorId: 7,
      costPrice: "175000",
      productUrl: "https://toko.example/rope",
    })
  })
})

describe("AddVendorToItemModal edit unpriced", () => {
  it("saves a link on an offer stored without a price", async () => {
    vi.mocked(itemsApi.addVendor).mockResolvedValue({
      vendorProductId: 6,
      vendorId: 8,
      vendorName: "PT Dermaga",
    })
    await mount(<Harness edit={{ vendorProductId: 6, vendorId: 8, vendorName: "PT Dermaga" }} />)
    const url = document.querySelector<HTMLInputElement>('input[type="url"]')
    if (!url) throw new Error("no link input")
    await type(url, "https://toko.example/dermaga")
    await click(button("Simpan"))
    expect(itemsApi.addVendor).toHaveBeenLastCalledWith(1, {
      vendorId: 8,
      costPrice: undefined,
      productUrl: "https://toko.example/dermaga",
    })
  })
})
