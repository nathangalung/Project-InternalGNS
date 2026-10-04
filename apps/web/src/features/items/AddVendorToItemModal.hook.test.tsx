import { QueryClientProvider } from "@tanstack/react-query"
import { act, useState } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { VendorListParams } from "@/features/vendors/api"
import * as vendorsApi from "@/features/vendors/api"
import { queryKeys } from "@/lib/query-keys"
import { byRole, click, mount, press, settle, type, unmount } from "@/test/dom"
import { testQueryClient } from "@/test/query"
import AddVendorToItemModal from "./AddVendorToItemModal"

vi.mock("@/features/vendors/api")

// Params the vendor search sends.
const noHits: VendorListParams = { q: "zzz", isActive: true, limit: 10 }

// Outer modal, no vendor hits.
function Harness() {
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
      <AddVendorToItemModal open={open} itemId={1} onOpenChange={setOpen} />
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
