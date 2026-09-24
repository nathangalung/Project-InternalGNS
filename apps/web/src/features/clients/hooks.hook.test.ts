import { beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "@/lib/api-client"
import { queryKeys } from "@/lib/query-keys"
import { toast } from "@/lib/toast"
import { invalidated, renderQueryHook, seed, settle, until } from "@/test/query"
import * as api from "./api"
import {
  useClient,
  useClientContacts,
  useClientLogoDownloadUrl,
  useClientSearch,
  useClientSummary,
  useClients,
  useCreateClient,
  useCreateContact,
  useDeleteContact,
  useUpdateClient,
  useUpdateContact,
  useUploadClientLogo,
} from "./hooks"

vi.mock("./api")
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))
vi.mock("@/lib/storage-upload", () => ({
  uploadWithFreshKey: vi.fn(async (presign: () => Promise<{ objectKey: string }>) => {
    return (await presign()).objectKey
  }),
}))

const m = vi.mocked(api)
const png = (size = 10) => new File([new Uint8Array(size)], "logo.png", { type: "image/png" })

const detail = queryKeys.clients.detail(7)
const list = queryKeys.clients.list({ limit: 10 })
const contacts = queryKeys.clients.contacts(7)
const others = [
  queryKeys.quotations.list(),
  queryKeys.purchaseOrders.list(),
  queryKeys.invoices.list(),
  queryKeys.dashboard.summary(),
]
const unrelated = queryKeys.units.list()

beforeEach(() => vi.clearAllMocks())

describe("client queries", () => {
  it("lists with the given params", async () => {
    m.list.mockResolvedValue({ rows: [], total: 3 })
    const { result } = renderQueryHook(() => useClients({ q: "a", limit: 5 }))
    await until(() => expect(result.current.data).toEqual({ rows: [], total: 3 }))
    expect(m.list).toHaveBeenCalledWith({ q: "a", limit: 5 })
  })

  it("reads the summary", async () => {
    m.summary.mockResolvedValue({ total: 4 } as never)
    const { result } = renderQueryHook(() => useClientSummary())
    await until(() => expect(result.current.data).toEqual({ total: 4 }))
  })

  it.each([undefined, 0])("does not fetch client %s", async (id) => {
    const { result } = renderQueryHook(() => useClient(id))
    await until(() => expect(result.current.fetchStatus).toBe("idle"))
    expect(m.get).not.toHaveBeenCalled()
  })

  it("fetches a real client", async () => {
    m.get.mockResolvedValue({ id: 7 } as never)
    const { result } = renderQueryHook(() => useClient(7))
    await until(() => expect(result.current.data).toEqual({ id: 7 }))
    expect(m.get).toHaveBeenCalledWith(7)
  })

  it("does not search a blank term", async () => {
    const { result } = renderQueryHook(() => useClientSearch("   "))
    await until(() => expect(result.current.fetchStatus).toBe("idle"))
    expect(m.search).not.toHaveBeenCalled()
  })

  it("searches with its options", async () => {
    m.search.mockResolvedValue([])
    const { result } = renderQueryHook(() => useClientSearch("pt", { limit: 5 }))
    await until(() => expect(result.current.isSuccess).toBe(true))
    expect(m.search).toHaveBeenCalledWith("pt", { limit: 5 })
  })

  it("loads contacts only for a real client", async () => {
    m.listContacts.mockResolvedValue([])
    const idle = renderQueryHook(() => useClientContacts(undefined))
    await until(() => expect(idle.result.current.fetchStatus).toBe("idle"))
    const { result } = renderQueryHook(() => useClientContacts(7))
    await until(() => expect(result.current.isSuccess).toBe(true))
    expect(m.listContacts).toHaveBeenCalledTimes(1)
    expect(m.listContacts).toHaveBeenCalledWith(7)
  })

  it("presigns the logo only when there is one", async () => {
    m.presignLogoDownload.mockResolvedValue({ downloadUrl: "u", expiresAt: 1 })
    const none = renderQueryHook(() => useClientLogoDownloadUrl(7, undefined))
    await until(() => expect(none.result.current.fetchStatus).toBe("idle"))
    const noId = renderQueryHook(() => useClientLogoDownloadUrl(undefined, "k"))
    await until(() => expect(noId.result.current.fetchStatus).toBe("idle"))
    expect(m.presignLogoDownload).not.toHaveBeenCalled()
    const { result } = renderQueryHook(() => useClientLogoDownloadUrl(7, "k"))
    await until(() => expect(result.current.data?.downloadUrl).toBe("u"))
  })
})

describe("client writes", () => {
  it("refreshes every client view after a create", async () => {
    m.create.mockResolvedValue({ id: 1 } as never)
    const { qc, result } = renderQueryHook(() => useCreateClient())
    seed(qc, [list, detail, unrelated])
    await settle(() => result.current.mutateAsync({ name: "PT A" }))
    expect(invalidated(qc, [list, detail, unrelated])).toEqual([list, detail])
  })

  it("toasts the server reason when a create fails", async () => {
    m.create.mockRejectedValue(new ApiError(422, null, "Nama klien sudah ada."))
    const { result } = renderQueryHook(() => useCreateClient())
    await settle(() => result.current.mutateAsync({ name: "PT A" }))
    expect(toast.error).toHaveBeenCalledWith("Nama klien sudah ada.")
  })

  it("refreshes the documents that print the client name after an update", async () => {
    m.update.mockResolvedValue({ id: 7 } as never)
    const { qc, result } = renderQueryHook(() => useUpdateClient())
    seed(qc, [detail, ...others, unrelated])
    await settle(() =>
      result.current.mutateAsync({
        id: 7,
        input: { name: "PT A", countryCode: "ID", isActive: true },
      }),
    )
    expect(invalidated(qc, [detail, ...others, unrelated])).toEqual([detail, ...others])
  })

  it("falls back to Indonesian copy when an update fails without a reason", async () => {
    m.update.mockRejectedValue(new TypeError(""))
    const { result } = renderQueryHook(() => useUpdateClient())
    await settle(() =>
      result.current.mutateAsync({
        id: 7,
        input: { name: "A", countryCode: "ID", isActive: true },
      }),
    )
    expect(toast.error).toHaveBeenCalledWith("Gagal memperbarui klien.")
  })
})

// An open detail form must not be refetched under in-progress edits.
describe("contact writes", () => {
  const contactInput = { name: "Budi", countryCode: "ID" }
  type Mutation = () => { mutateAsync: (vars: never) => Promise<unknown> }
  const cases: [string, Mutation, () => void, () => void, unknown, string][] = [
    [
      "create",
      () => useCreateContact(),
      () => m.createContact.mockResolvedValue({ id: 3 } as never),
      () => m.createContact.mockRejectedValue(new Error("")),
      { companyId: 7, input: contactInput },
      "Gagal menyimpan kontak.",
    ],
    [
      "update",
      () => useUpdateContact(),
      () => m.updateContact.mockResolvedValue({ id: 3 } as never),
      () => m.updateContact.mockRejectedValue(new Error("")),
      { companyId: 7, contactId: 3, input: contactInput },
      "Gagal memperbarui kontak.",
    ],
    [
      "delete",
      () => useDeleteContact(),
      () => m.deleteContact.mockResolvedValue(undefined),
      () => m.deleteContact.mockRejectedValue(new Error("")),
      { companyId: 7, contactId: 3 },
      "Gagal menghapus kontak.",
    ],
  ]

  it.each(cases)(
    "%s refreshes contacts and lists, not the detail",
    async (_n, hook, ok, _f, vars) => {
      ok()
      const { qc, result } = renderQueryHook(hook)
      const otherContacts = queryKeys.clients.contacts(8)
      seed(qc, [contacts, list, detail, otherContacts])
      await settle(() => result.current.mutateAsync(vars as never))
      expect(invalidated(qc, [contacts, list, detail, otherContacts])).toEqual([contacts, list])
    },
  )

  it.each(cases)("%s toasts Indonesian copy on failure", async (_n, hook, _ok, fail, vars, msg) => {
    fail()
    const { result } = renderQueryHook(hook)
    await settle(() => result.current.mutateAsync(vars as never))
    expect(toast.error).toHaveBeenCalledWith(msg)
  })
})

describe("useUploadClientLogo", () => {
  it("uploads, saves the key, and refreshes the detail only", async () => {
    m.presignLogoUpload.mockResolvedValue({
      uploadUrl: "/u",
      objectKey: "clients/7/a.png",
      expiresAt: 1,
    })
    m.updateLogo.mockResolvedValue(undefined)
    const { qc, result } = renderQueryHook(() => useUploadClientLogo())
    seed(qc, [detail, list])
    await settle(() => result.current.mutateAsync({ id: 7, file: png() }))
    expect(m.presignLogoUpload).toHaveBeenCalledWith(7, "logo.png")
    expect(m.updateLogo).toHaveBeenCalledWith(7, "clients/7/a.png")
    expect(invalidated(qc, [detail, list])).toEqual([detail])
  })

  // MD-13: a refused file never reaches storage.
  it("refuses an invalid file before asking for an upload URL", async () => {
    const { qc, result } = renderQueryHook(() => useUploadClientLogo())
    seed(qc, [detail])
    await settle(() => result.current.mutateAsync({ id: 7, file: png(3 * 1024 * 1024) }))
    expect(m.presignLogoUpload).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith("Ukuran logo klien melebihi 2 MB.")
    expect(invalidated(qc, [detail])).toEqual([])
  })

  it("keeps the old logo when saving the key fails", async () => {
    m.presignLogoUpload.mockResolvedValue({ uploadUrl: "/u", objectKey: "k", expiresAt: 1 })
    m.updateLogo.mockRejectedValue(new Error(""))
    const { qc, result } = renderQueryHook(() => useUploadClientLogo())
    seed(qc, [detail])
    await settle(() => result.current.mutateAsync({ id: 7, file: png() }))
    expect(toast.error).toHaveBeenCalledWith("Gagal mengunggah logo.")
    expect(invalidated(qc, [detail])).toEqual([])
  })
})
