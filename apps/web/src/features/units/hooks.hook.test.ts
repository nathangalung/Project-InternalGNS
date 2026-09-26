import { describe, expect, it, vi } from "vitest"
import { queryKeys } from "@/lib/query-keys"
import { renderQueryHook, until } from "@/test/query"
import * as api from "./api"
import { useUnits } from "./hooks"

vi.mock("./api")

describe("useUnits", () => {
  it("caches units under their key and keeps them fresh", async () => {
    vi.mocked(api.list).mockResolvedValue([{ id: 1 }] as never)
    const { qc, result } = renderQueryHook(() => useUnits())
    await until(() => expect(result.current.data).toEqual([{ id: 1 }]))
    expect(qc.getQueryData(queryKeys.units.list())).toEqual([{ id: 1 }])
    expect(result.current.isStale).toBe(false)
  })
})
