import { describe, expect, it } from "vitest"
import { ApiError } from "./api-client"
import { errorMessage, isMissing } from "./errors"

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

describe("errorMessage", () => {
  it.each<[string, unknown, string]>([
    ["API detail", new ApiError(422, null, "Nama wajib diisi."), "Nama wajib diisi."],
    ["API blank message", new ApiError(500, null, "   "), "Gagal."],
    ["plain Error", new Error("Koneksi terputus"), "Koneksi terputus"],
    ["blank Error", new Error(""), "Gagal."],
    ["string thrown", "boom", "Gagal."],
    ["nothing thrown", undefined, "Gagal."],
  ])("%s", (_name, err, want) => {
    expect(errorMessage(err, "Gagal.")).toBe(want)
  })

  it("trims the message it shows", () => {
    expect(errorMessage(new Error("  Gagal login.  "), "x")).toBe("Gagal login.")
  })
})
