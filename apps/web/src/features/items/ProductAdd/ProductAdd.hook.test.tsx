import { QueryClientProvider } from "@tanstack/react-query"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import * as itemsApi from "@/features/items/api"
import * as unitsApi from "@/features/units/api"
import { ApiError } from "@/lib/api-client"
import { byRole, mount, settle, unmount } from "@/test/dom"
import { throwingQueryClient } from "@/test/query"
import type { ItemRow } from "@/types/api"
import ProductAdd from "."

vi.mock("@/features/items/api")
vi.mock("@/features/vendors/api")
vi.mock("@/features/units/api")

const items = vi.mocked(itemsApi)

const ACTIVE = { id: 1, name: "Baut Baja", impaCode: "330212", isActive: true } as ItemRow
const RETIRED = { id: 2, name: "Ampelas Lama", impaCode: null, isActive: false } as ItemRow

function field(label: string): HTMLInputElement {
  const lbl = [...document.querySelectorAll("label")].find((l) => l.textContent?.startsWith(label))
  const el = document.getElementById(lbl?.htmlFor ?? "")
  if (!(el instanceof HTMLInputElement)) throw new Error(`no field ${label}`)
  return el
}

async function open() {
  await mount(
    <QueryClientProvider client={throwingQueryClient()}>
      <ProductAdd open onOpenChange={vi.fn()} onSuccess={vi.fn()} />
    </QueryClientProvider>,
  )
  await settle()
}

async function focusProduct() {
  const input = field("Kode IMPA/Nama Produk *")
  input.focus()
  input.dispatchEvent(new FocusEvent("focusin", { bubbles: true }))
  await settle()
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(unitsApi.list).mockResolvedValue([])
  // The server filters as the real list does.
  items.list.mockImplementation(async (params = {}) => {
    const rows = params.isActive ? [ACTIVE] : [ACTIVE, RETIRED]
    return { rows, total: rows.length }
  })
})
afterEach(unmount)

describe("ProductAdd catalog", () => {
  it("never offers a deactivated product for a new line", async () => {
    await open()
    await focusProduct()
    const offered = byRole("option").map((o) => o.textContent)
    expect(offered).toContain("330212 - Baut Baja")
    expect(offered).not.toContain("Ampelas Lama")
  })

  it("shows a failed catalog beside the field and keeps the dialog", async () => {
    items.list.mockRejectedValue(new ApiError(502, null, ""))
    await open()
    await focusProduct()
    expect(document.body.textContent).toContain("Gagal memuat katalog produk.")
    expect(byRole("dialog")).toHaveLength(1)
  })
})
