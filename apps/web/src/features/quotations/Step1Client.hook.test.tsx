import { afterEach, describe, expect, it, vi } from "vitest"
import { button, byRole, click, mount, unmount } from "@/test/dom"
import Step1Client from "./Step1Client"

const base = {
  search: "pt",
  setSearch: vi.fn(),
  filteredClients: [],
  selectedClient: "",
  setSelectedClient: vi.fn(),
  setShowClientAdd: vi.fn(),
}

afterEach(unmount)

describe("Step1Client lookup", () => {
  it("says the client list failed and retries it", async () => {
    const failure = { retry: vi.fn(), retrying: false }
    await mount(<Step1Client {...base} clientsFailure={failure} />)
    expect(byRole("alert").map((a) => a.textContent)).toEqual([
      "Gagal memuat daftar klien.Coba Lagi",
    ])
    await click(button("Coba Lagi"))
    expect(failure.retry).toHaveBeenCalledTimes(1)
  })

  it("shows no error while the list loads fine", async () => {
    await mount(<Step1Client {...base} />)
    expect(byRole("alert")).toEqual([])
  })
})
