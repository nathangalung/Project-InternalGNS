import { describe, expect, it } from "vitest"
import { ApiError } from "./api-client"
import { queryClient, shouldRetry } from "./query-client"

describe("shouldRetry", () => {
  it.each<[string, number, unknown, boolean]>([
    ["404 is final", 0, new ApiError(404, null, "x"), false],
    ["403 is final", 0, new ApiError(403, null, "x"), false],
    ["5xx retries once", 0, new ApiError(503, null, "x"), true],
    ["5xx stops after one retry", 1, new ApiError(503, null, "x"), false],
    ["network error retries once", 0, new TypeError("Failed to fetch"), true],
  ])("%s", (_name, count, err, want) => {
    expect(shouldRetry(count, err)).toBe(want)
  })
})

describe("queryClient defaults", () => {
  const { queries, mutations } = queryClient.getDefaultOptions()

  it("sends outages to the error boundary and leaves 4xx inline", () => {
    const throwOnError = queries?.throwOnError
    if (typeof throwOnError !== "function") throw new Error("throwOnError must be a function")
    const decide = (err: Error) => throwOnError(err, {} as never)
    expect(decide(new ApiError(404, null, "x"))).toBe(false)
    expect(decide(new ApiError(403, null, "x"))).toBe(false)
    expect(decide(new ApiError(500, null, "x"))).toBe(true)
    expect(decide(new TypeError("Failed to fetch"))).toBe(true)
  })

  it("retries queries through shouldRetry and never retries a write", () => {
    expect(queries?.retry).toBe(shouldRetry)
    expect(mutations?.retry).toBe(0)
  })
})
