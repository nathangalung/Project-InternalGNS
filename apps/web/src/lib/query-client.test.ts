import { describe, expect, it } from "vitest"
import { ApiError } from "./api-client"
import { shouldRetry } from "./query-client"

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
