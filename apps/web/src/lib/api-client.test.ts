import { afterEach, describe, expect, it, vi } from "vitest"
import { problem } from "@/test/problem"
import type { ProblemDetail } from "@/types/api"
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
    const body = problem(422, {
      detail: "Status PO tidak dapat diubah dari DELIVERED.",
      fields: { status: "invalid" },
    })
    expect(extractErrorMessage(body, "fallback")).toBe(
      "Status PO tidak dapat diubah dari DELIVERED.",
    )
  })

  it("never renders a field name as prose", () => {
    // Regression: the old join produced "db: Cannot edit quotation 12 ...".
    const body = problem(422, { fields: { db: "Cannot edit quotation 12" } })
    const msg = extractErrorMessage(body, "fallback")
    expect(msg).toBe("Cannot edit quotation 12")
    expect(msg).not.toContain("db:")
  })

  it("joins field values only, in body order", () => {
    const body = problem(422, { fields: { name: "Nama wajib diisi", email: "Email tidak valid" } })
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
    const viaFields = extractErrorMessage(problem(422, { fields: body.fields }), "fallback")
    expect(viaDetail).toBe("Email wajib diisi.; Kata sandi wajib diisi.")
    expect(viaDetail).toBe(viaFields)
  })

  it("skips blank field values instead of emitting empty segments", () => {
    const body = problem(422, { fields: { name: "Nama wajib diisi", note: "  " } })
    expect(extractErrorMessage(body, "fallback")).toBe("Nama wajib diisi")
  })

  it("falls back to title when detail and fields are unusable", () => {
    expect(extractErrorMessage(problem(404, { title: "Not Found", fields: {} }), "fallback")).toBe(
      "Not Found",
    )
  })

  it("reads a problem body without fields", () => {
    expect(extractErrorMessage(problem(403, { title: "Forbidden" }), "fallback")).toBe("Forbidden")
    expect(extractErrorMessage(problem(500, { title: "" }), "Internal Server Error")).toBe(
      "Internal Server Error",
    )
  })

  it("falls back to the status text without a body", () => {
    expect(extractErrorMessage(null, "Bad Gateway")).toBe("Bad Gateway")
  })
})

describe("parseProblem", () => {
  const conflict = { type: "about:blank", title: "Conflict", status: 409, detail: "Tidak ada." }
  const invalid = {
    type: "about:blank",
    title: "Unprocessable Entity",
    status: 422,
    fields: { note: "Wajib." },
    code: "x",
  }

  it.each<[string, string, unknown]>([
    ["problem JSON", JSON.stringify(conflict), conflict],
    ["problem with fields and code", JSON.stringify(invalid), invalid],
    ["empty body", "", null],
    ["proxy HTML page", "<html>502</html>", null],
    ["JSON that is not a problem", '{"detail":"Tidak ada."}', null],
    ["an array", "[1,2]", null],
    ["a JSON string", '"boom"', null],
    ["a non-string detail", '{"title":"x","status":422,"detail":5}', null],
    ["a non-string code", '{"title":"x","status":422,"code":5}', null],
    ["non-string field values", '{"title":"x","status":422,"fields":{"a":3}}', null],
    ["fields that are not an object", '{"title":"x","status":422,"fields":"a"}', null],
    ["null fields", '{"title":"x","status":422,"fields":null}', null],
  ])("%s", (_name, text, want) => {
    expect(parseProblem(text)).toEqual(want)
  })
})

describe("transferFailureMessage", () => {
  const detail = (d: string) => problem(409, { detail: d })

  it.each<[string, "upload" | "download", number, ProblemDetail | null, string]>([
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
    [
      "download 422 fields",
      "download",
      422,
      problem(422, { fields: { npwp: "NPWP kosong." } }),
      "NPWP kosong.",
    ],
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
    const fetchMock = respond(
      401,
      JSON.stringify(
        problem(401, { title: "Unauthorized", detail: "Email atau kata sandi salah." }),
      ),
    )
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
    respond(409, JSON.stringify(problem(409, { detail: "object already exists" })))
    const file = new File(["x"], "a.pdf", { type: "application/pdf" })
    const err = await uploadAsset("/storage/po-docs/po/1/a.pdf", file).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(409)
    expect((err as ApiError).message).toBe(
      "Berkas dengan nama yang sama baru saja diunggah. Coba lagi.",
    )
  })
})
