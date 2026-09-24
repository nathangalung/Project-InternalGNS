import { describe, expect, it, vi } from "vitest"
import { queryKeys } from "@/lib/query-keys"
import { renderQueryHook, until } from "@/test/query"
import * as api from "./api"
import { useCountries } from "./hooks"

vi.mock("./api")

describe("useCountries", () => {
  it("caches countries under their key and keeps them fresh", async () => {
    vi.mocked(api.list).mockResolvedValue([{ code: "ID" }] as never)
    const { qc, result } = renderQueryHook(() => useCountries())
    await until(() => expect(result.current.data).toEqual([{ code: "ID" }]))
    expect(qc.getQueryData(queryKeys.countries.list())).toEqual([{ code: "ID" }])
    expect(result.current.isStale).toBe(false)
  })
})
