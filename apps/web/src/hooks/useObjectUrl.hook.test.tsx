import { act } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { fetchObjectUrl } from "@/lib/api-client"
import { renderHook } from "@/test/renderHook"
import { useObjectUrl } from "./useObjectUrl"

vi.mock("@/lib/api-client", () => ({ fetchObjectUrl: vi.fn() }))

const fetchUrl = vi.mocked(fetchObjectUrl)
const revoke = vi.fn()

// Settle pending promises.
const flush = () => act(async () => {})

beforeEach(() => {
  vi.clearAllMocks()
  URL.revokeObjectURL = revoke
})

afterEach(() => vi.restoreAllMocks())

type Props = { path?: string }
const render = (path?: string) =>
  renderHook(({ path }: Props) => useObjectUrl(path), { path } as Props)

describe("useObjectUrl", () => {
  it("stays empty without a path", async () => {
    const { result } = render(undefined)
    await flush()
    expect(result.current).toBe("")
    expect(fetchUrl).not.toHaveBeenCalled()
  })

  it("loads the object and revokes it on unmount", async () => {
    fetchUrl.mockResolvedValue("blob:a")
    const { result, unmount } = render("/storage/object?key=a")
    await flush()
    expect(fetchUrl).toHaveBeenCalledWith("/storage/object?key=a")
    expect(result.current).toBe("blob:a")
    unmount()
    expect(revoke).toHaveBeenCalledWith("blob:a")
  })

  it("swaps objects when the path changes and empties when it goes", async () => {
    fetchUrl.mockResolvedValueOnce("blob:a").mockResolvedValueOnce("blob:b")
    const { result, rerender } = render("/a")
    await flush()
    rerender({ path: "/b" })
    await flush()
    expect(revoke).toHaveBeenCalledWith("blob:a")
    expect(result.current).toBe("blob:b")
    rerender({ path: undefined })
    await flush()
    expect(revoke).toHaveBeenCalledWith("blob:b")
    expect(result.current).toBe("")
  })

  it("revokes an object that lands after the path moved on", async () => {
    let land: (u: string) => void = () => {}
    fetchUrl.mockReturnValueOnce(
      new Promise<string>((r) => {
        land = r
      }),
    )
    const { result, unmount } = render("/slow")
    unmount()
    await act(async () => land("blob:late"))
    expect(revoke).toHaveBeenCalledWith("blob:late")
    expect(result.current).toBe("")
  })

  it("stays empty when the download fails", async () => {
    fetchUrl.mockRejectedValue(new Error("gone"))
    const { result } = render("/broken")
    await flush()
    expect(result.current).toBe("")
  })
})
