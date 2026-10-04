import { QueryClientProvider } from "@tanstack/react-query"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import * as clientsApi from "@/features/clients/api"
import { ApiError } from "@/lib/api-client"
import { button, click, mount, settle, unmount } from "@/test/dom"
import { throwingQueryClient } from "@/test/query"
import ContactModal from "./ContactModal"

vi.mock("@/features/clients/api")
vi.mock("@/features/quotations/api")

const m = vi.mocked(clientsApi)
const EMPTY = "Klien ini belum memiliki narahubung aktif."

async function open() {
  await mount(
    <QueryClientProvider client={throwingQueryClient()}>
      <ContactModal quotationId={1} companyId={7} onClose={vi.fn()} />
    </QueryClientProvider>,
  )
  await settle()
}

beforeEach(() => vi.clearAllMocks())
afterEach(unmount)

describe("ContactModal", () => {
  it("says the load failed, not that the client has no contacts, and retries", async () => {
    m.listContacts.mockRejectedValueOnce(new ApiError(500, null, ""))
    await open()
    expect(document.body.textContent).toContain("Gagal memuat narahubung.")
    expect(document.body.textContent).not.toContain(EMPTY)

    m.listContacts.mockResolvedValueOnce([
      { id: 3, name: "Budi", isActive: true } as Awaited<ReturnType<typeof m.listContacts>>[0],
    ])
    await click(button("Coba Lagi"))
    await settle()
    expect(m.listContacts).toHaveBeenCalledTimes(2)
    expect(document.body.textContent).toContain("Budi")
    expect(document.body.textContent).not.toContain("Gagal memuat narahubung.")
  })

  it("still says so when the client has no active contact", async () => {
    m.listContacts.mockResolvedValueOnce([])
    await open()
    expect(document.body.textContent).toContain(EMPTY)
  })
})
