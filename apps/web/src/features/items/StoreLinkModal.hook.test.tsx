import { QueryClientProvider } from "@tanstack/react-query"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import * as itemsApi from "@/features/items/api"
import { ApiError } from "@/lib/api-client"
import { STORE_URL_ERROR } from "@/lib/store-link"
import { button, byRole, click, mount, settle, type, unmount } from "@/test/dom"
import { problem } from "@/test/problem"
import { testQueryClient } from "@/test/query"
import StoreLinkModal from "./StoreLinkModal"

vi.mock("@/features/items/api")

const addVendor = vi.mocked(itemsApi.addVendor)
const onClose = vi.fn()

async function open(current?: string) {
  await mount(
    <QueryClientProvider client={testQueryClient()}>
      <StoreLinkModal
        itemId={9}
        vendorId={4}
        vendorName="PT Tali Jaya"
        current={current}
        onClose={onClose}
      />
    </QueryClientProvider>,
  )
}

function urlInput(): HTMLInputElement {
  const el = document.querySelector<HTMLInputElement>('input[type="url"]')
  if (!el) throw new Error("no url input")
  return el
}

const title = () => byRole("dialog")[0]?.querySelector("h2")?.textContent
const alerts = () => byRole("alert").map((a) => a.textContent)

beforeEach(() => {
  vi.clearAllMocks()
  addVendor.mockResolvedValue({ vendorProductId: 1, vendorId: 4, vendorName: "PT Tali Jaya" })
})
afterEach(unmount)

describe("StoreLinkModal", () => {
  it("adds a link for the vendor, sending no price so the stored one stays", async () => {
    await open()
    expect(title()).toBe("Tambah Link Toko")
    expect(document.body.textContent).toContain("PT Tali Jaya")
    expect(button("Simpan").disabled).toBe(true)
    await type(urlInput(), " https://toko.example/tali ")
    await click(button("Simpan"))
    await settle()
    expect(addVendor).toHaveBeenCalledWith(9, {
      vendorId: 4,
      productUrl: "https://toko.example/tali",
    })
    expect(onClose).toHaveBeenCalled()
  })

  it("changes a stored link and clears one with null", async () => {
    await open("https://toko.example/lama")
    expect(title()).toBe("Ubah Link Toko")
    expect(urlInput().value).toBe("https://toko.example/lama")
    expect(button("Simpan").disabled).toBe(true)
    await type(urlInput(), "")
    await click(button("Simpan"))
    await settle()
    expect(addVendor).toHaveBeenCalledWith(9, { vendorId: 4, productUrl: null })
  })

  it("refuses an address that is not http or https before saving", async () => {
    await open()
    await type(urlInput(), "javascript:alert(1)")
    expect(document.body.textContent).toContain(STORE_URL_ERROR)
    expect(urlInput().getAttribute("aria-invalid")).toBe("true")
    expect(button("Simpan").disabled).toBe(true)
  })

  it("keeps the dialog and says why when the server refuses", async () => {
    addVendor.mockRejectedValue(
      new ApiError(
        422,
        problem(422, { fields: { vendorId: "Vendor sudah nonaktif." } }),
        "Vendor sudah nonaktif.",
      ),
    )
    await open()
    await type(urlInput(), "https://toko.example/tali")
    await click(button("Simpan"))
    await settle()
    expect(alerts()).toContain("Vendor sudah nonaktif.")
    expect(onClose).not.toHaveBeenCalled()
  })

  it("puts a refused link under its input", async () => {
    addVendor.mockRejectedValue(
      new ApiError(422, problem(422, { fields: { productUrl: "Link ditolak." } }), "x"),
    )
    await open()
    await type(urlInput(), "https://toko.example/tali")
    await click(button("Simpan"))
    await settle()
    expect(document.body.textContent).toContain("Link ditolak.")
    expect(urlInput().getAttribute("aria-invalid")).toBe("true")
  })

  it("closes on Batal without saving", async () => {
    await open()
    await click(button("Batal"))
    expect(onClose).toHaveBeenCalled()
    expect(addVendor).not.toHaveBeenCalled()
  })
})
