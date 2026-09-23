import { afterEach, describe, expect, it, vi } from "vitest"
import {
  ApiError,
  apiRequest,
  extractErrorMessage,
  parseProblem,
  transferFailureMessage,
  uploadAsset,
} from "./api-client"

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

describe("parseProblem", () => {
  it.each<[string, string, unknown]>([
    ["problem JSON", '{"detail":"Tidak ada."}', { detail: "Tidak ada." }],
    ["empty body", "", null],
    ["proxy HTML page", "<html>502</html>", null],
  ])("%s", (_name, text, want) => {
    expect(parseProblem(text)).toEqual(want)
  })
})

describe("transferFailureMessage", () => {
  const detail = (d: string) => ({ detail: d })

  it.each<[string, "upload" | "download", number, unknown, string]>([
    [
      "upload key clash",
      "upload",
      409,
      detail("object already exists"),
      "Berkas dengan nama yang sama baru saja diunggah. Coba lagi.",
    ],
    [
      "upload refused type",
      "upload",
      400,
      detail("file type not allowed"),
      "Jenis berkas tidak diizinkan.",
    ],
    ["upload store down", "upload", 502, detail("upload failed"), "Gagal mengunggah berkas."],
    [
      "download 409 is written for the user",
      "download",
      409,
      detail("Surat jalan baru terbit setelah pekerjaan PO dimulai (ON_PROGRESS)."),
      "Surat jalan baru terbit setelah pekerjaan PO dimulai (ON_PROGRESS).",
    ],
    ["download 422 fields", "download", 422, { fields: { npwp: "NPWP kosong." } }, "NPWP kosong."],
    ["download English 404", "download", 404, detail("not found"), "Gagal mengunduh berkas."],
    ["download 409 without body", "download", 409, null, "Gagal mengunduh berkas."],
  ])("%s", (_name, kind, status, problem, want) => {
    expect(transferFailureMessage(kind, status, problem)).toBe(want)
  })
})

describe("failed responses", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function respond(status: number, body: string) {
    const fetchMock = vi.fn(async () => new Response(body, { status }))
    vi.stubGlobal("fetch", fetchMock)
    return fetchMock
  }

  it("keeps a credential 401 as the server's answer, without a refresh", async () => {
    const fetchMock = respond(401, JSON.stringify({ detail: "Email atau kata sandi salah." }))
    const err = await apiRequest({ path: "/auth/login", method: "POST", authed: false }).catch(
      (e: unknown) => e,
    )
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).message).toBe("Email atau kata sandi salah.")
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("turns a non-JSON error page into a typed error", async () => {
    respond(502, "<html>Bad Gateway</html>")
    const err = await apiRequest({ path: "/x", authed: false }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(502)
    expect((err as ApiError).message).toBe("Permintaan gagal (502).")
  })

  it("never shows the proxy's English upload detail", async () => {
    vi.stubGlobal("sessionStorage", { getItem: () => null })
    respond(409, JSON.stringify({ title: "Conflict", detail: "object already exists" }))
    const file = new File(["x"], "a.pdf", { type: "application/pdf" })
    const err = await uploadAsset("/storage/po-docs/po/1/a.pdf", file).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(409)
    expect((err as ApiError).message).toBe(
      "Berkas dengan nama yang sama baru saja diunggah. Coba lagi.",
    )
  })
})
