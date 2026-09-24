import { describe, expect, it, vi } from "vitest"
import { apiRequest } from "@/lib/api-client"
import { list } from "./api"

vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  apiRequest: vi.fn(async () => []),
}))

describe("countries api", () => {
  it("reads the full list", async () => {
    await list()
    expect(apiRequest).toHaveBeenCalledWith({ path: "/countries" })
  })
})
