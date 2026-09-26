import { afterEach, describe, expect, it, vi } from "vitest"
import { ApiError, uploadAsset } from "@/lib/api-client"
import { uploadWithFreshKey } from "./storage-upload"

vi.mock("@/lib/api-client", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/api-client")>()
  return { ...actual, uploadAsset: vi.fn() }
})

const upload = vi.mocked(uploadAsset)
const file = new File(["x"], "a.png", { type: "image/png" })

function presigner() {
  let n = 0
  return vi.fn(async () => {
    n++
    return { uploadUrl: `/storage/u/${n}`, objectKey: `key-${n}`, expiresAt: 0 }
  })
}

describe("uploadWithFreshKey", () => {
  afterEach(() => {
    upload.mockReset()
  })

  it("returns the key of a first-try upload", async () => {
    upload.mockResolvedValueOnce()
    const presign = presigner()
    await expect(uploadWithFreshKey(presign, file, 0)).resolves.toBe("key-1")
    expect(presign).toHaveBeenCalledTimes(1)
  })

  it("re-presigns once after a key clash", async () => {
    upload.mockRejectedValueOnce(new ApiError(409, null, "clash")).mockResolvedValueOnce()
    const presign = presigner()
    await expect(uploadWithFreshKey(presign, file, 0)).resolves.toBe("key-2")
    expect(presign).toHaveBeenCalledTimes(2)
    expect(upload).toHaveBeenLastCalledWith("/storage/u/2", file)
  })

  it("gives up after the second clash", async () => {
    upload.mockRejectedValue(new ApiError(409, null, "clash"))
    await expect(uploadWithFreshKey(presigner(), file, 0)).rejects.toMatchObject({ status: 409 })
    expect(upload).toHaveBeenCalledTimes(2)
  })

  it("does not retry other failures", async () => {
    upload.mockRejectedValue(new ApiError(502, null, "down"))
    await expect(uploadWithFreshKey(presigner(), file, 0)).rejects.toMatchObject({ status: 502 })
    expect(upload).toHaveBeenCalledTimes(1)
  })
})
