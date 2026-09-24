import { beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError, apiList, apiRequest } from "@/lib/api-client"
import * as api from "./api"

vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  apiRequest: vi.fn(async () => undefined),
  apiList: vi.fn(async () => ({ rows: [], total: 0 })),
  downloadPdf: vi.fn(async () => {}),
  downloadXlsx: vi.fn(async () => {}),
  getRefreshToken: vi.fn(() => null),
}))

const request = vi.mocked(apiRequest)
const profile = { name: "Sari", email: "sari@gns.id", role: "finance", isActive: true } as const

describe("users api", () => {
  beforeEach(() => vi.clearAllMocks())

  it.each<[string, api.ListParams | undefined, string]>([
    ["no params", undefined, "/users"],
    [
      "filters",
      { q: "sari", role: "finance", isActive: false, limit: 5 },
      "/users?q=sari&role=finance&isActive=false&limit=5",
    ],
  ])("lists with %s", async (_name, params, path) => {
    await api.list(params)
    expect(apiList).toHaveBeenCalledWith({ path })
  })

  it("gets and creates", async () => {
    await api.get(3)
    expect(request).toHaveBeenCalledWith({ path: "/users/3" })
    const input = { ...profile, password: "Rahasia123!" }
    await api.create(input)
    expect(request).toHaveBeenCalledWith({ path: "/users", method: "POST", body: input })
  })

  it("updates the profile only when no password is given", async () => {
    request.mockResolvedValueOnce({ id: 3 })
    await expect(api.update(3, profile)).resolves.toEqual({ id: 3 })
    expect(request).toHaveBeenCalledTimes(1)
    expect(request).toHaveBeenCalledWith({ path: "/users/3", method: "PUT", body: profile })
  })

  it("keeps the password out of the profile PUT and PATCHes it after", async () => {
    await api.update(3, { ...profile, password: "BaruSekali1!" })
    expect(request.mock.calls.map(([input]) => input)).toEqual([
      { path: "/users/3", method: "PUT", body: profile },
      { path: "/users/3/password", method: "PATCH", body: { password: "BaruSekali1!" } },
    ])
  })

  it("reports a saved profile with a failed password as partial", async () => {
    const cause = new ApiError(422, null, "Kata sandi terlalu pendek.")
    request.mockResolvedValueOnce({ id: 3 }).mockRejectedValueOnce(cause)
    const err = await api.update(3, { ...profile, password: "x" }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(api.PartialUserUpdateError)
    expect(err).toMatchObject({
      profileSaved: true,
      passwordError: cause,
      message: "Kata sandi terlalu pendek.",
      name: "PartialUserUpdateError",
    })
  })

  it("gives a partial failure Indonesian copy when the cause has none", () => {
    expect(new api.PartialUserUpdateError("boom").message).toBe("Kata sandi gagal diperbarui")
  })

  it("does not touch the password when the profile PUT fails", async () => {
    request.mockRejectedValueOnce(new ApiError(409, null, "Email sudah dipakai."))
    await expect(api.update(3, { ...profile, password: "x" })).rejects.toMatchObject({
      status: 409,
    })
    expect(request).toHaveBeenCalledTimes(1)
  })
})
