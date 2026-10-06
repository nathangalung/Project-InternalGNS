import { act } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { queryKeys } from "@/lib/query-keys"
import { toast } from "@/lib/toast"
import { invalidated, renderQueryHook, seed, until } from "@/test/query"
import type { CashEntryInput } from "@/types/api"
import * as api from "./api"
import {
  useCashCategories,
  useCashEntries,
  useCashSummary,
  useDeleteCashEntry,
  useSaveCashEntry,
} from "./hooks"

vi.mock("./api")
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))

const m = vi.mocked(api)
const listKey = queryKeys.cashEntries.list({})
const input: CashEntryInput = {
  entryDate: "2026-09-15",
  direction: "in",
  category: "Modal",
  amount: "100",
  description: "Setoran",
}

beforeEach(() => vi.clearAllMocks())

describe("cash entry queries", () => {
  it("lists, totals and suggests", async () => {
    m.list.mockResolvedValue({ rows: [], total: 0 })
    m.summary.mockResolvedValue({ totalIn: "0", totalOut: "0", net: "0" })
    m.categories.mockResolvedValue(["Modal"])
    const l = renderQueryHook(() => useCashEntries({ q: "x" }))
    const s = renderQueryHook(() => useCashSummary({ q: "x" }))
    const c = renderQueryHook(() => useCashCategories())
    await until(() => expect(l.result.current.isSuccess).toBe(true))
    await until(() => expect(s.result.current.isSuccess).toBe(true))
    await until(() => expect(c.result.current.data).toEqual(["Modal"]))
    expect(m.list).toHaveBeenCalledWith({ q: "x" })
    expect(m.summary).toHaveBeenCalledWith({ q: "x" })
  })
})

describe("cash entry writes", () => {
  it("creates without an id and edits with its version", async () => {
    m.create.mockResolvedValue({ id: 1 } as never)
    m.update.mockResolvedValue({ id: 1 } as never)
    const { qc, result } = renderQueryHook(() => useSaveCashEntry())
    seed(qc, [listKey])
    await act(() => result.current.mutateAsync({ input }))
    expect(m.create).toHaveBeenCalledWith(input)
    await act(() => result.current.mutateAsync({ id: 1, rowVersion: 3, input }))
    expect(m.update).toHaveBeenCalledWith(1, input, 3)
    expect(invalidated(qc, [listKey])).toEqual([listKey])
  })

  it("deletes and says so, or says why not", async () => {
    m.remove.mockResolvedValue()
    const { qc, result } = renderQueryHook(() => useDeleteCashEntry())
    seed(qc, [listKey])
    await act(() => result.current.mutateAsync(1))
    expect(toast.success).toHaveBeenCalledWith("Catatan kas dihapus.")
    expect(invalidated(qc, [listKey])).toEqual([listKey])

    m.remove.mockRejectedValue(new Error("offline"))
    await act(async () => {
      await result.current.mutateAsync(2).catch(() => {})
    })
    expect(toast.error).toHaveBeenCalledWith("offline")
  })
})
