import { act } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import * as authApi from "@/features/auth/api"
import { clearAuthState } from "@/features/auth/hooks"
import { ApiError } from "@/lib/api-client"
import { queryKeys } from "@/lib/query-keys"
import { toast } from "@/lib/toast"
import { invalidated, renderQueryHook, seed, settle, until } from "@/test/query"
import * as api from "./api"
import {
  useChangeOwnPassword,
  useCreateUser,
  useEndOwnSession,
  useUpdateUser,
  useUser,
  useUsers,
} from "./hooks"

const navigate = vi.fn()

vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  list: vi.fn(),
  get: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
}))
vi.mock("@/features/auth/api")
vi.mock("@/features/auth/hooks", () => ({ clearAuthState: vi.fn() }))
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }))
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))

const m = vi.mocked(api)
const me = queryKeys.auth.me()
const userDetail = queryKeys.users.detail(3)
const userList = queryKeys.users.list()
const input = { name: "Sari", email: "sari@gns.id", role: "finance", isActive: true } as const

beforeEach(() => vi.clearAllMocks())

describe("user queries", () => {
  it("lists with the given params", async () => {
    m.list.mockResolvedValue({ rows: [], total: 0 })
    const { result } = renderQueryHook(() => useUsers({ role: "finance" }))
    await until(() => expect(result.current.isSuccess).toBe(true))
    expect(m.list).toHaveBeenCalledWith({ role: "finance" })
  })

  it("fetches a user only for a real id", async () => {
    m.get.mockResolvedValue({ id: 3 } as never)
    const idle = renderQueryHook(() => useUser(undefined))
    await until(() => expect(idle.result.current.fetchStatus).toBe("idle"))
    const { result } = renderQueryHook(() => useUser(3))
    await until(() => expect(result.current.data).toEqual({ id: 3 }))
    expect(m.get).toHaveBeenCalledTimes(1)
  })
})

describe("useCreateUser", () => {
  it("refreshes the user list", async () => {
    m.create.mockResolvedValue({ id: 3 } as never)
    const { qc, result } = renderQueryHook(() => useCreateUser())
    seed(qc, [userList, me])
    await settle(() => result.current.mutateAsync({ ...input, password: "x" }))
    expect(invalidated(qc, [userList, me])).toEqual([userList])
  })

  // Field, conflict errors render inline.
  it.each([422, 409])("leaves a %i to the form", async (status) => {
    m.create.mockRejectedValue(new ApiError(status, null, "Email sudah digunakan pengguna lain."))
    const { result } = renderQueryHook(() => useCreateUser())
    await settle(() => result.current.mutateAsync({ ...input, password: "x" }))
    expect(toast.error).not.toHaveBeenCalled()
  })

  it("toasts a server fault", async () => {
    m.create.mockRejectedValue(new ApiError(500, null, ""))
    const { result } = renderQueryHook(() => useCreateUser())
    await settle(() => result.current.mutateAsync({ ...input, password: "x" }))
    expect(toast.error).toHaveBeenCalledWith("Gagal menyimpan pengguna.")
  })
})

describe("useUpdateUser", () => {
  // AU-10: sidebar reads me cache.
  it("refreshes users and the signed-in user after an edit", async () => {
    m.update.mockResolvedValue({ id: 3 } as never)
    const { qc, result } = renderQueryHook(() => useUpdateUser())
    seed(qc, [userDetail, me])
    await settle(() => result.current.mutateAsync({ id: 3, input }))
    expect(invalidated(qc, [userDetail, me])).toEqual([userDetail, me])
  })

  it("skips the refetch when the edit ends the caller's own session", async () => {
    m.update.mockResolvedValue({ id: 3 } as never)
    const { qc, result } = renderQueryHook(() => useUpdateUser())
    seed(qc, [userDetail, me])
    await settle(() => result.current.mutateAsync({ id: 3, input, endsOwnSession: true }))
    expect(invalidated(qc, [userDetail, me])).toEqual([])
  })

  it("still refreshes, without a toast, when only the password failed", async () => {
    m.update.mockRejectedValue(new api.PartialUserUpdateError(new Error("x")))
    const { qc, result } = renderQueryHook(() => useUpdateUser())
    seed(qc, [userDetail, me])
    await settle(() => result.current.mutateAsync({ id: 3, input: { ...input, password: "x" } }))
    await until(() => expect(invalidated(qc, [userDetail, me])).toEqual([userDetail, me]))
    expect(toast.error).not.toHaveBeenCalled()
  })

  it("leaves a 409 to the form", async () => {
    m.update.mockRejectedValue(new ApiError(409, null, "Superadmin terakhir."))
    const { result } = renderQueryHook(() => useUpdateUser())
    await settle(() => result.current.mutateAsync({ id: 3, input }))
    expect(toast.error).not.toHaveBeenCalled()
  })

  it("toasts a network failure", async () => {
    m.update.mockRejectedValue(new TypeError("Failed to fetch"))
    const { result } = renderQueryHook(() => useUpdateUser())
    await settle(() => result.current.mutateAsync({ id: 3, input }))
    expect(toast.error).toHaveBeenCalledWith("Failed to fetch")
  })
})

describe("own session", () => {
  it("changes the own password through the auth endpoint", async () => {
    vi.mocked(authApi.changeOwnPassword).mockResolvedValue(undefined)
    const { result } = renderQueryHook(() => useChangeOwnPassword())
    const body = { currentPassword: "lama", newPassword: "BaruSekali1!" }
    await settle(() => result.current.mutateAsync(body))
    expect(vi.mocked(authApi.changeOwnPassword).mock.calls[0][0]).toEqual(body)
  })

  it.each<["success" | "info" | "error" | undefined, "success" | "info" | "error"]>([
    [undefined, "info"],
    ["success", "success"],
    ["error", "error"],
  ])("signs out locally with a %s notice and goes to login", (tone, shown) => {
    const { result } = renderQueryHook(() => useEndOwnSession())
    act(() => result.current("Kata sandi diubah. Silakan masuk kembali.", tone))
    expect(clearAuthState).toHaveBeenCalledTimes(1)
    expect(toast[shown]).toHaveBeenCalledWith("Kata sandi diubah. Silakan masuk kembali.")
    expect(navigate).toHaveBeenCalledWith({ to: "/login" })
    expect(authApi.logout).not.toHaveBeenCalled()
  })
})
