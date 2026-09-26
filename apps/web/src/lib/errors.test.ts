import { describe, expect, it } from "vitest"
import { ApiError } from "./api-client"
import {
  errorMessage,
  isMissing,
  isVersionConflict,
  problemCode,
  VERSION_CONFLICT_CODE,
} from "./errors"

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

describe("problemCode", () => {
  it.each<[string, unknown, string | undefined]>([
    ["tagged", new ApiError(409, { code: "po_locked" }, "x"), "po_locked"],
    ["no code", new ApiError(409, { detail: "x" }, "x"), undefined],
    ["non-string code", new ApiError(409, { code: 7 }, "x"), undefined],
    ["null body", new ApiError(409, null, "x"), undefined],
    ["plain Error", new Error("x"), undefined],
  ])("%s", (_name, err, want) => {
    expect(problemCode(err)).toBe(want)
  })
})

describe("isVersionConflict", () => {
  const body = { status: 409, code: VERSION_CONFLICT_CODE, detail: "Data ini baru saja diubah." }
  it.each<[string, unknown, boolean]>([
    ["tagged 409", new ApiError(409, body, body.detail), true],
    ["lock 409", new ApiError(409, { code: "po_locked" }, "Invoice sudah terbit."), false],
    ["untagged 409 naming row_version", new ApiError(409, null, "row_version mismatch"), false],
    ["tag outside a 409", new ApiError(422, body, body.detail), false],
    ["plain Error", new Error("version_conflict"), false],
  ])("%s", (_name, err, want) => {
    expect(isVersionConflict(err)).toBe(want)
  })

  it("matches the server tag", () => {
    expect(VERSION_CONFLICT_CODE).toBe("version_conflict")
  })
})
