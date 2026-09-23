import { describe, expect, it } from "vitest"
import { ApiError } from "./api-client"
import { isMissing } from "./errors"

describe("isMissing", () => {
  it.each<[string, unknown, boolean]>([
    ["404", new ApiError(404, null, "x"), true],
    ["400 bad id", new ApiError(400, null, "x"), true],
    ["403", new ApiError(403, null, "x"), false],
    ["500", new ApiError(500, null, "x"), false],
    ["network", new TypeError("Failed to fetch"), false],
    ["no error", null, false],
  ])("%s", (_name, err, want) => {
    expect(isMissing(err)).toBe(want)
  })
})
