import { describe, expect, it } from "vitest"
import { ApiError } from "@/lib/api-client"
import { EMAIL_TAKEN_MESSAGE, formErrors, isInlineFormError } from "./form-errors"

const KEYS = ["name", "email", "password", "role"] as const

function apiErr(status: number, body: unknown, message = "pesan server") {
  return new ApiError(status, body, message)
}

describe("isInlineFormError", () => {
  it.each([
    [apiErr(422, null), true],
    [apiErr(409, null), true],
    [apiErr(500, null), false],
    [apiErr(401, null), false],
    [new Error("x"), false],
  ])("%#", (err, want) => {
    expect(isInlineFormError(err)).toBe(want)
  })
})

describe("formErrors", () => {
  it("puts 422 fields on their inputs", () => {
    const err = apiErr(422, {
      detail: "Nama wajib diisi.; Format email tidak valid.",
      fields: { name: "Nama wajib diisi.", email: "Format email tidak valid." },
    })
    expect(formErrors(err, KEYS, "gagal")).toEqual({
      fields: { name: "Nama wajib diisi.", email: "Format email tidak valid." },
      banner: null,
    })
  })

  it("sends unknown fields to the banner", () => {
    const err = apiErr(422, { fields: { email: "Format email tidak valid.", other: "Lain." } })
    expect(formErrors(err, KEYS, "gagal")).toEqual({
      fields: { email: "Format email tidak valid." },
      banner: "Lain.",
    })
  })

  it("maps the duplicate email 409 to the email field", () => {
    const err = apiErr(409, { detail: EMAIL_TAKEN_MESSAGE }, EMAIL_TAKEN_MESSAGE)
    expect(formErrors(err, KEYS, "gagal")).toEqual({
      fields: { email: EMAIL_TAKEN_MESSAGE },
      banner: null,
    })
  })

  it("keeps other 409s in the banner", () => {
    const msg = "Superadmin aktif terakhir tidak dapat diturunkan atau dinonaktifkan."
    const err = apiErr(409, { detail: msg }, msg)
    expect(formErrors(err, KEYS, "gagal")).toEqual({ fields: {}, banner: msg })
  })

  it("keeps the duplicate email in the banner without an email input", () => {
    const err = apiErr(409, { detail: EMAIL_TAKEN_MESSAGE }, EMAIL_TAKEN_MESSAGE)
    expect(formErrors(err, ["newPassword"] as const, "gagal")).toEqual({
      fields: {},
      banner: EMAIL_TAKEN_MESSAGE,
    })
  })

  it("maps self-service password fields", () => {
    const err = apiErr(422, { fields: { currentPassword: "Kata sandi saat ini salah." } })
    expect(formErrors(err, ["currentPassword", "newPassword"] as const, "gagal")).toEqual({
      fields: { currentPassword: "Kata sandi saat ini salah." },
      banner: null,
    })
  })

  it("uses the prose of a 422 without fields", () => {
    const err = apiErr(422, { detail: "Peran tidak valid." }, "Peran tidak valid.")
    expect(formErrors(err, KEYS, "gagal")).toEqual({ fields: {}, banner: "Peran tidak valid." })
  })

  it("falls back for an empty message", () => {
    expect(formErrors(apiErr(500, null, ""), KEYS, "gagal")).toEqual({
      fields: {},
      banner: "gagal",
    })
    expect(formErrors("boom", KEYS, "gagal")).toEqual({ fields: {}, banner: "gagal" })
  })

  it("skips blank field messages", () => {
    const err = apiErr(422, { fields: { name: "  " } }, "Data tidak valid.")
    expect(formErrors(err, KEYS, "gagal")).toEqual({ fields: {}, banner: "Data tidak valid." })
  })
})
