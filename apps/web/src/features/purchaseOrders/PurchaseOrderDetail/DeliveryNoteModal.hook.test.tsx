import { QueryClientProvider } from "@tanstack/react-query"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "@/lib/api-client"
import { button, click, mount, settle, type, unmount } from "@/test/dom"
import { problem } from "@/test/problem"
import { testQueryClient } from "@/test/query"
import type { PurchaseOrderItemRow } from "@/types/api"
import * as api from "../api"
import DeliveryNoteModal from "./DeliveryNoteModal"
import { PO_CONFLICT_MESSAGE } from "./helpers"

vi.mock("../api")

const save = vi.mocked(api.updateDeliveryNote)
const onDownload = vi.fn(async () => {})
const onClose = vi.fn()

const line = (over: Partial<PurchaseOrderItemRow>): PurchaseOrderItemRow => ({
  id: 1,
  poId: 3,
  lineNumber: 1,
  itemType: "product",
  itemName: "Tali Tambang",
  qty: "2",
  unitCode: "PCS",
  isAvailable: true,
  ...over,
})

const items = [
  line({ id: 11 }),
  line({ id: 12, itemName: "Cat Kapal", dnNoteDefault: "Kirim ke: Gudang Cakung" }),
  line({ id: 13, itemType: "shipping", itemName: "Pengiriman" }),
]

async function open() {
  await mount(
    <QueryClientProvider client={testQueryClient()}>
      <DeliveryNoteModal
        poId={3}
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
  save.mockResolvedValue({ id: 3, rowVersion: 8 })
})
afterEach(unmount)

describe("DeliveryNoteModal", () => {
  it("lists every product row with its starting note", async () => {
    await open()
    expect(inputs().map((i) => i.value)).toEqual(["", "Kirim ke: Gudang Cakung"])
    expect(text()).toContain("1. Tali Tambang")
    expect(text()).toContain("2. Cat Kapal")
    expect(text()).not.toContain("Pengiriman")
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
    await type(inputs()[0], "Serahkan ke mualim")
    await click(button("Simpan dan Unduh"))
    expect(save).toHaveBeenCalledWith(
      3,
      {
        notes: [
          { lineId: 11, note: "Serahkan ke mualim" },
          { lineId: 12, note: "Kirim ke: Gudang Cakung" },
        ],
      },
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
    expect(text()).toContain(PO_CONFLICT_MESSAGE)
    expect(onDownload).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it("puts a long note's refusal on its row", async () => {
    save.mockRejectedValue(
      new ApiError(
        422,
        problem(422, { fields: { "notes[0].note": "Catatan paling banyak 500 karakter." } }),
        "Unprocessable",
      ),
    )
    await open()
    await type(inputs()[0], "x")
    await click(button("Simpan dan Unduh"))
    expect(inputs()[0].getAttribute("aria-invalid")).toBe("true")
    expect(text()).toContain("Catatan paling banyak 500 karakter.")
  })

  it("says so when the download fails and stays open", async () => {
    onDownload.mockRejectedValueOnce(new Error("gone"))
    await open()
    await click(button("Unduh"))
    expect(text()).toContain("Surat Jalan gagal diunduh. Coba lagi.")
    expect(onClose).not.toHaveBeenCalled()
  })

  it("closes on Batal", async () => {
    await open()
    await click(button("Batal"))
    expect(onClose).toHaveBeenCalled()
  })
})
