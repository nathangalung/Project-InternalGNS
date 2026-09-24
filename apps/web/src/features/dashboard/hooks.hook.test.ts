import { act } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { toast } from "@/lib/toast"
import { renderQueryHook, until } from "@/test/query"
import * as api from "./api"
import { useDashboardExport, useDashboardSummary, useDashboardTimeseries } from "./hooks"

vi.mock("./api")
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))

const m = vi.mocked(api)

beforeEach(() => vi.clearAllMocks())

describe("dashboard queries", () => {
  it("reads the summary", async () => {
    m.summary.mockResolvedValue({ quotationCount: 3 } as never)
    const { result } = renderQueryHook(() => useDashboardSummary())
    await until(() => expect(result.current.data).toEqual({ quotationCount: 3 }))
  })

  it("reads one metric over a window", async () => {
    m.timeseries.mockResolvedValue([])
    const { result } = renderQueryHook(() =>
      useDashboardTimeseries("revenue", "2026-09-01", "2026-10-01", "day"),
    )
    await until(() => expect(result.current.isSuccess).toBe(true))
    expect(m.timeseries).toHaveBeenCalledWith("revenue", "2026-09-01", "2026-10-01", "day")
  })

  // A role without financial access must not even ask.
  it("does not ask for a disabled metric", async () => {
    const { result } = renderQueryHook(() =>
      useDashboardTimeseries("profit", undefined, undefined, undefined, false),
    )
    await until(() => expect(result.current.fetchStatus).toBe("idle"))
    expect(m.timeseries).not.toHaveBeenCalled()
  })
})

describe("useDashboardExport", () => {
  it("flags the export while it runs and clears it after", async () => {
    let finish: () => void = () => {}
    m.exportXlsx.mockReturnValue(new Promise<void>((r) => (finish = r)))
    const { result } = renderQueryHook(() => useDashboardExport())
    let run: Promise<void> = Promise.resolve()
    act(() => {
      run = result.current.exportXlsx(2026)
    })
    expect(result.current.exporting).toBe(true)
    expect(m.exportXlsx).toHaveBeenCalledWith(2026)
    await act(async () => {
      finish()
      await run
    })
    expect(result.current.exporting).toBe(false)
    expect(toast.error).not.toHaveBeenCalled()
  })

  it("toasts fixed Indonesian copy instead of the English status", async () => {
    m.exportXlsx.mockRejectedValue(new Error("Forbidden"))
    const { result } = renderQueryHook(() => useDashboardExport())
    await act(() => result.current.exportXlsx(2026))
    expect(toast.error).toHaveBeenCalledWith("Gagal mengunduh file Excel dashboard. Coba lagi.")
    expect(result.current.exporting).toBe(false)
  })
})
