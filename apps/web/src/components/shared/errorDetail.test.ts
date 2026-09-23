import { describe, expect, it } from "vitest"
import { ApiError } from "@/lib/api-client"
import { errorCopy } from "./errorDetail"

describe("errorCopy", () => {
  const cases: { name: string; err: unknown; dev: boolean; detail: string | null }[] = [
    {
      name: "5xx hides its text",
      err: new ApiError(500, null, "pq: boom"),
      dev: true,
      detail: null,
    },
    {
      name: "503 hides its text",
      err: new ApiError(503, null, "upstream"),
      dev: false,
      detail: null,
    },
    {
      name: "4xx keeps the API detail",
      err: new ApiError(404, null, "Klien tidak ditemukan."),
      dev: false,
      detail: "Klien tidak ditemukan.",
    },
    {
      name: "blank 4xx detail is dropped",
      err: new ApiError(400, null, "  "),
      dev: false,
      detail: null,
    },
    {
      name: "exception hidden in production",
      err: new TypeError("x is undefined"),
      dev: false,
      detail: null,
    },
    {
      name: "exception shown in development",
      err: new TypeError("x is undefined"),
      dev: true,
      detail: "x is undefined",
    },
    { name: "non-error value in production", err: { weird: true }, dev: false, detail: null },
  ]
  for (const c of cases) {
    it(c.name, () => {
      expect(errorCopy(c.err, c.dev).detail).toBe(c.detail)
    })
  }

  it("uses the server message for 5xx", () => {
    expect(errorCopy(new ApiError(502, null, "bad gateway"), false).message).toMatch(/Server/)
  })
})
