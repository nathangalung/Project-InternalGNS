import { describe, expect, it } from "vitest"
import { extractErrorMessage } from "./api-client"

describe("extractErrorMessage", () => {
  it("prefers detail over every other source", () => {
    const body = {
      title: "Unprocessable Entity",
      detail: "Status PO tidak dapat diubah dari DELIVERED.",
      fields: { status: "invalid" },
    }
    expect(extractErrorMessage(body, "fallback")).toBe(
      "Status PO tidak dapat diubah dari DELIVERED.",
    )
  })

  it("never renders a field name as prose", () => {
    // Regression: the old join produced "db: Cannot edit quotation 12 ...".
    const body = { title: "Unprocessable Entity", fields: { db: "Cannot edit quotation 12" } }
    const msg = extractErrorMessage(body, "fallback")
    expect(msg).toBe("Cannot edit quotation 12")
    expect(msg).not.toContain("db:")
  })

  it("joins field values only, in body order", () => {
    const body = { fields: { name: "Nama wajib diisi", email: "Email tidak valid" } }
    expect(extractErrorMessage(body, "fallback")).toBe("Nama wajib diisi; Email tidak valid")
  })

  it("matches the server's own detail for a real 422 login body", () => {
    // Wire shape captured from httperr.Unprocessable; detail and fields agree,
    // so the toast reads the same whichever branch a body exercises.
    const body = {
      type: "about:blank",
      title: "Unprocessable Entity",
      status: 422,
      detail: "Email wajib diisi.; Kata sandi wajib diisi.",
      fields: { email: "Email wajib diisi.", password: "Kata sandi wajib diisi." },
    }
    const viaDetail = extractErrorMessage(body, "fallback")
    const viaFields = extractErrorMessage({ fields: body.fields }, "fallback")
    expect(viaDetail).toBe("Email wajib diisi.; Kata sandi wajib diisi.")
    expect(viaDetail).toBe(viaFields)
  })

  it("skips blank field values instead of emitting empty segments", () => {
    const body = { fields: { name: "Nama wajib diisi", note: "  " } }
    expect(extractErrorMessage(body, "fallback")).toBe("Nama wajib diisi")
  })

  it("falls back to title when detail and fields are unusable", () => {
    expect(extractErrorMessage({ title: "Not Found", fields: {} }, "fallback")).toBe("Not Found")
  })

  it("falls back to the status text for a non-object body", () => {
    expect(extractErrorMessage(null, "Bad Gateway")).toBe("Bad Gateway")
    expect(extractErrorMessage("boom", "Bad Gateway")).toBe("Bad Gateway")
  })
})
