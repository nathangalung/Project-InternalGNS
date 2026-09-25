import { beforeEach, describe, expect, it, vi } from "vitest"
import { apiRequest, getRefreshToken } from "@/lib/api-client"
import { changeOwnPassword, login, logout, me } from "./api"

vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  apiRequest: vi.fn(async () => undefined),
  apiList: vi.fn(async () => ({ rows: [], total: 0 })),
  downloadPdf: vi.fn(async () => {}),
  downloadXlsx: vi.fn(async () => {}),
  getRefreshToken: vi.fn(() => null),
}))

const request = vi.mocked(apiRequest)

describe("auth api", () => {
  beforeEach(() => vi.clearAllMocks())

  // AU-4: wrong password reads verbatim.
  //
  // A wrong password must read as the server's answer.
  it("logs in as a credential call, outside the refresh cycle", async () => {
    await login("a@gns.id", "rahasia")
    expect(request).toHaveBeenCalledWith({
      path: "/auth/login",
      method: "POST",
      body: { email: "a@gns.id", password: "rahasia" },
      authed: false,
    })
  })

  it("reads the signed-in user", async () => {
    await me()
    expect(request).toHaveBeenCalledWith({ path: "/auth/me" })
  })

  it.each<[string, string | null, unknown]>([
    ["revokes the refresh token it holds", "r1", { refreshToken: "r1" }],
    ["sends no body without one", null, undefined],
  ])("logout %s", async (_name, token, body) => {
    vi.mocked(getRefreshToken).mockReturnValue(token)
    await logout()
    expect(request).toHaveBeenCalledWith({ path: "/auth/logout", method: "POST", body })
  })

  it("changes the own password with a PATCH", async () => {
    const input = { currentPassword: "lama", newPassword: "BaruSekali1!" }
    await changeOwnPassword(input)
    expect(request).toHaveBeenCalledWith({
      path: "/auth/me/password",
      method: "PATCH",
      body: input,
    })
  })
})
