import { QueryClientProvider } from "@tanstack/react-query"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "@/lib/api-client"
import { button, click, mount, settle, type, unmount } from "@/test/dom"
import { problem } from "@/test/problem"
import { testQueryClient } from "@/test/query"
import type { InvoiceItemRow } from "@/types/api"
import * as api from "../api"
import DescriptionModal from "./DescriptionModal"
import { DESCRIPTION_CONFLICT_MESSAGE } from "./description"

vi.mock("../api")

const save = vi.mocked(api.updateDescriptions)
const onDownload = vi.fn(async () => {})
const onClose = vi.fn()

const line = (over: Partial<InvoiceItemRow>): InvoiceItemRow => ({
  id: 1,
  invoiceId: 3,
  lineType: "product",
  itemName: "Tali Tambang",
  qty: "2",
  unitPrice: "1000",
  unitCode: "PCS",
  ...over,
})

const items = [
  line({ id: 11, itemCode: "790269" }),
  line({ id: 12, itemName: "Cat Kapal", shipDestination: "Gudang Cakung" }),
  line({ id: 13, lineType: "shipping", itemName: "Pengiriman", unitCode: undefined }),
]

async function open() {
  await mount(
    <QueryClientProvider client={testQueryClient()}>
      <DescriptionModal
        invoiceId={3}
        rowVersion={7}
        items={items}
        onDownload={onDownload}
        onClose={onClose}
      />
    </QueryClientProvider>,
  )
  await settle()
}

const inputs = () => [...document.querySelectorAll<HTMLInputElement>("input")]
const text = () => document.body.textContent ?? ""

beforeEach(() => {
  vi.clearAllMocks()
  save.mockResolvedValue({ rowVersion: 8 })
})
afterEach(unmount)

describe("DescriptionModal", () => {
  it("lists every printed line with its starting description", async () => {
    await open()
    expect(inputs().map((i) => i.value)).toEqual(["", "Gudang Cakung", ""])
    expect(text()).toContain("1. 790269 - Tali Tambang")
    expect(text()).toContain("2. Cat Kapal")
    expect(text()).toContain("3. Pengiriman")
  })

  it("only downloads when nothing changed", async () => {
    await open()
    await click(button("Unduh"))
    expect(save).not.toHaveBeenCalled()
    expect(onDownload).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalled()
  })

  it("saves every row with the row version, then downloads", async () => {
    await open()
    await type(inputs()[0], "Warna abu abu")
    await click(button("Simpan dan Unduh"))
    expect(save).toHaveBeenCalledWith(
      3,
      [
        { lineId: 11, description: "Warna abu abu" },
        { lineId: 12, description: "Gudang Cakung" },
        { lineId: 13, description: "" },
      ],
      7,
    )
    expect(onDownload).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalled()
  })

  it("shows a stale version in the dialog and does not download", async () => {
    save.mockRejectedValue(
      new ApiError(409, problem(409, { code: "version_conflict" }), "Conflict"),
    )
    await open()
    await type(inputs()[1], "")
    await click(button("Simpan dan Unduh"))
    expect(text()).toContain(DESCRIPTION_CONFLICT_MESSAGE)
    expect(onDownload).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it("puts a long description's refusal on its row", async () => {
    save.mockRejectedValue(
      new ApiError(
        422,
        problem(422, {
          fields: { "lines[0].description": "Deskripsi paling banyak 500 karakter." },
        }),
        "Unprocessable",
      ),
    )
    await open()
    await type(inputs()[0], "x")
    await click(button("Simpan dan Unduh"))
    expect(inputs()[0].getAttribute("aria-invalid")).toBe("true")
    expect(text()).toContain("Deskripsi paling banyak 500 karakter.")
  })

  it("says so when the download fails and stays open", async () => {
    onDownload.mockRejectedValueOnce(new Error("gone"))
    await open()
    await click(button("Unduh"))
    expect(text()).toContain("PDF invoice gagal diunduh. Coba lagi.")
    expect(onClose).not.toHaveBeenCalled()
  })

  it("closes on Batal", async () => {
    await open()
    await click(button("Batal"))
    expect(onClose).toHaveBeenCalled()
  })
})
