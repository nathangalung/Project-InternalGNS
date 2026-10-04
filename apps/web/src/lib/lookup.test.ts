import { describe, expect, it, vi } from "vitest"
import { lookupFailure } from "./lookup"

const query = (isError: boolean, isFetching = false) => ({
  isError,
  isFetching,
  refetch: vi.fn(),
})

describe("lookupFailure", () => {
  it("is null while every lookup is fine", () => {
    expect(lookupFailure(query(false), query(false))).toBeNull()
    expect(lookupFailure()).toBeNull()
  })

  it("retries only the failed lookups", () => {
    const ok = query(false)
    const failed = query(true)
    const failure = lookupFailure(ok, failed)
    expect(failure?.retrying).toBe(false)
    failure?.onRetry()
    expect(failed.refetch).toHaveBeenCalledTimes(1)
    expect(ok.refetch).not.toHaveBeenCalled()
  })

  it("is retrying while a failed lookup refetches", () => {
    expect(lookupFailure(query(true, true), query(true))?.retrying).toBe(true)
  })
})
