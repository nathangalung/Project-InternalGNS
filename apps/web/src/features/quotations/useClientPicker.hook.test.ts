import { act } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import * as clientsApi from "@/features/clients/api"
import { renderQueryHook, until } from "@/test/query"
import type { ClientRow, ClientSearchHit, ContactRow } from "@/types/api"
import { useClientPicker } from "./useClientPicker"

vi.mock("@/features/clients/api")
const m = vi.mocked(clientsApi)

const row = (id: number, name: string): ClientRow =>
  ({ id, name, countryCode: "IDN", isActive: true }) as ClientRow
const hit = (id: number, name: string): ClientSearchHit =>
  ({ companyId: id, companyName: name, companyCountry: "IDN" }) as ClientSearchHit

beforeEach(() => {
  vi.clearAllMocks()
  m.list.mockResolvedValue({ rows: [row(1, "PT Alfa"), row(2, "PT Beta")], total: 12 })
  m.listContacts.mockResolvedValue([])
})

describe("useClientPicker", () => {
  it("pages the active clients by name", async () => {
    const { result } = renderQueryHook(() => useClientPicker(""))
    await until(() =>
      expect(result.current.filteredClients.map((c) => c.name)).toEqual(["PT Alfa", "PT Beta"]),
    )
    expect(m.list).toHaveBeenCalledWith({
      limit: 10,
      offset: 0,
      isActive: true,
      sortBy: "name",
      sortDir: "asc",
    })
    expect(result.current.picker).toMatchObject({ page: 1, pages: 2, from: 1, to: 10, total: 12 })
    expect(result.current.clientsFailure).toBeNull()

    act(() => result.current.picker.onPage(2))
    await until(() =>
      expect(m.list).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 10 })),
    )
  })

  it("pages a search here and starts it on page one", async () => {
    const hits = Array.from({ length: 12 }, (_, i) =>
      hit(100 + i, `PT Hasil ${String(i).padStart(2, "0")}`),
    )
    m.search.mockResolvedValue(hits)
    const { result } = renderQueryHook(() => useClientPicker(""))
    await until(() => expect(result.current.filteredClients).toHaveLength(2))
    act(() => result.current.picker.onPage(2))
    act(() => result.current.changeSearch("hasil"))
    expect(result.current.search).toBe("hasil")
    await until(() => expect(result.current.filteredClients).toHaveLength(10))
    expect(m.search).toHaveBeenCalledWith("hasil", { limit: 200 })
    expect(result.current.picker).toMatchObject({ page: 1, pages: 2, total: 12 })
    act(() => result.current.picker.onPage(2))
    await until(() =>
      expect(result.current.filteredClients.map((c) => c.name)).toEqual([
        "PT Hasil 10",
        "PT Hasil 11",
      ]),
    )
  })

  it("keeps a picked client off the page in view, with its contacts", async () => {
    m.get.mockResolvedValue(row(9, "PT Saudara"))
    const contact = { id: 5, name: "Ibu Sari" } as ContactRow
    m.listContacts.mockResolvedValue([contact])
    const { result } = renderQueryHook(() => useClientPicker("9"))
    expect(result.current.contactsPending).toBe(true)
    await until(() => expect(result.current.currentClient?.name).toBe("PT Saudara"))
    expect(m.get).toHaveBeenCalledWith(9)
    expect(result.current.filteredClients.map((c) => c.id)).toEqual(["9", "1", "2"])
    await until(() => expect(result.current.contacts).toEqual([contact]))
    expect(result.current.contactsPending).toBe(false)
    expect(m.listContacts).toHaveBeenCalledWith(9)
  })

  it("reads no contacts before a pick", async () => {
    const { result } = renderQueryHook(() => useClientPicker(""))
    await until(() => expect(result.current.filteredClients).toHaveLength(2))
    expect(result.current.contacts).toEqual([])
    expect(result.current.contactsPending).toBe(false)
    expect(result.current.currentClient).toBeUndefined()
    expect(m.listContacts).not.toHaveBeenCalled()
    expect(m.get).not.toHaveBeenCalled()
  })

  it("reports a failed list for a retry", async () => {
    m.list.mockRejectedValue(new Error("down"))
    const { result } = renderQueryHook(() => useClientPicker(""))
    await until(() => expect(result.current.clientsFailure).not.toBeNull())
    m.list.mockResolvedValue({ rows: [row(1, "PT Alfa")], total: 1 })
    act(() => result.current.clientsFailure?.onRetry())
    await until(() => expect(result.current.clientsFailure).toBeNull())
    expect(result.current.filteredClients.map((c) => c.name)).toEqual(["PT Alfa"])
  })
})
