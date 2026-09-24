// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  ApiError,
  apiList,
  apiRequest,
  buildQuery,
  clearTokens,
  downloadFile,
  downloadPdf,
  downloadXlsx,
  downloadXml,
  fetchObjectUrl,
  getRefreshToken,
  nullOn404,
  saveBlob,
  setOnAuthExpired,
  setTokens,
  uploadAsset,
} from "./api-client"

type Call = { path: string; init: RequestInit }
type Handler = (path: string, init: RequestInit) => Response | Promise<Response>

// Fetch stub routed by path.
function serve(handler: Handler) {
  const calls: Call[] = []
  const fetchMock = vi.fn(async (url: string, init: RequestInit = {}) => {
    const path = url.replace(/^.*\/api\/v1/, "")
    calls.push({ path, init })
    return handler(path, init)
  })
  vi.stubGlobal("fetch", fetchMock)
  return calls
}

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: { "content-type": "application/json", ...init.headers },
  })

const header = (c: Call, name: string) => new Headers(c.init.headers).get(name)

beforeEach(() => sessionStorage.clear())
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
  setOnAuthExpired(() => {})
})

describe("token storage", () => {
  it("stores both tokens and clears them together", () => {
    setTokens({ token: "a", refreshToken: "r" })
    expect(sessionStorage.getItem("gns_token")).toBe("a")
    expect(getRefreshToken()).toBe("r")
    clearTokens()
    expect(sessionStorage.getItem("gns_token")).toBeNull()
    expect(getRefreshToken()).toBeNull()
  })

  it("keeps the refresh token when only the access token changes", () => {
    setTokens({ token: "a", refreshToken: "r" })
    setTokens({ token: "b" })
    expect(sessionStorage.getItem("gns_token")).toBe("b")
    expect(getRefreshToken()).toBe("r")
  })
})

describe("apiRequest", () => {
  it("sends the bearer token, JSON body and extra headers", async () => {
    setTokens({ token: "tok" })
    const calls = serve(() => json({ id: 1 }))
    const out = await apiRequest<{ id: number }>({
      path: "/quotations/1",
      method: "PUT",
      body: { a: 1 },
      headers: { "If-Match": "3" },
    })
    expect(out).toEqual({ id: 1 })
    expect(calls).toHaveLength(1)
    expect(calls[0].path).toBe("/quotations/1")
    expect(calls[0].init.method).toBe("PUT")
    expect(calls[0].init.body).toBe('{"a":1}')
    expect(header(calls[0], "authorization")).toBe("Bearer tok")
    expect(header(calls[0], "content-type")).toBe("application/json")
    expect(header(calls[0], "if-match")).toBe("3")
  })

  it("defaults to GET with no body and no token", async () => {
    const calls = serve(() => json([]))
    await apiRequest({ path: "/units" })
    expect(calls[0].init.method).toBe("GET")
    expect(calls[0].init.body).toBeUndefined()
    expect(header(calls[0], "authorization")).toBeNull()
  })

  // AU-4: credentials never ride on a stale session.
  it("leaves the token off a credential call", async () => {
    setTokens({ token: "stale" })
    const calls = serve(() => json({ token: "new" }))
    await apiRequest({ path: "/auth/login", method: "POST", body: {}, authed: false })
    expect(header(calls[0], "authorization")).toBeNull()
  })

  it.each<[string, Response, unknown]>([
    ["204 resolves to undefined", new Response(null, { status: 204 }), undefined],
    ["an empty 200 resolves to null", new Response("", { status: 200 }), null],
  ])("%s", async (_name, res, want) => {
    serve(() => res)
    await expect(apiRequest({ path: "/x" })).resolves.toBe(want)
  })

  // AU-7: the rate limiter answered in plain text.
  it("turns a plain-text 429 into a typed error, not a JSON crash", async () => {
    serve(() => new Response("Too Many Requests", { status: 429 }))
    const err = await apiRequest({ path: "/auth/login", authed: false }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ status: 429, body: null, message: "Permintaan gagal (429)." })
  })

  it("keeps the problem body on the error", async () => {
    const problem = { title: "Conflict", detail: "Nomor PO sudah dipakai." }
    serve(() => json(problem, { status: 409 }))
    const err = await apiRequest({ path: "/x", authed: false }).catch((e: unknown) => e)
    expect(err).toMatchObject({ status: 409, body: problem, message: "Nomor PO sudah dipakai." })
  })
})

describe("session refresh", () => {
  it("refreshes once on a 401 and replays the request with the new token", async () => {
    setTokens({ token: "old", refreshToken: "r1" })
    const calls = serve((path, init) => {
      if (path === "/auth/refresh") return json({ token: "new", refreshToken: "r2" })
      const auth = new Headers(init.headers).get("authorization")
      return auth === "Bearer new" ? json({ ok: true }) : new Response("", { status: 401 })
    })
    await expect(apiRequest({ path: "/users" })).resolves.toEqual({ ok: true })
    expect(calls.map((c) => c.path)).toEqual(["/users", "/auth/refresh", "/users"])
    expect(JSON.parse(String(calls[1].init.body))).toEqual({ refreshToken: "r1" })
    expect(sessionStorage.getItem("gns_token")).toBe("new")
    expect(getRefreshToken()).toBe("r2")
  })

  it("shares one refresh between parallel 401s", async () => {
    setTokens({ token: "old", refreshToken: "r1" })
    const calls = serve((path, init) => {
      if (path === "/auth/refresh") return json({ token: "new", refreshToken: "r2" })
      const auth = new Headers(init.headers).get("authorization")
      return auth === "Bearer new" ? json(path) : new Response("", { status: 401 })
    })
    const out = await Promise.all([apiRequest({ path: "/a" }), apiRequest({ path: "/b" })])
    expect(out).toEqual(["/a", "/b"])
    expect(calls.filter((c) => c.path === "/auth/refresh")).toHaveLength(1)
  })

  it.each<[string, string | null, Handler]>([
    ["no refresh token", null, () => new Response("", { status: 401 })],
    [
      "the refresh is refused",
      "r1",
      (path) =>
        path === "/auth/refresh"
          ? json({ detail: "revoked" }, { status: 401 })
          : new Response("", { status: 401 }),
    ],
  ])("ends the session when %s", async (_name, refresh, handler) => {
    setTokens(refresh ? { token: "old", refreshToken: refresh } : { token: "old" })
    const expired = vi.fn()
    setOnAuthExpired(expired)
    const calls = serve(handler)
    const err = await apiRequest({ path: "/users" }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ status: 401, message: "Sesi berakhir, silakan masuk kembali." })
    expect(expired).toHaveBeenCalledTimes(1)
    expect(sessionStorage.getItem("gns_token")).toBeNull()
    expect(getRefreshToken()).toBeNull()
    expect(calls.filter((c) => c.path === "/users")).toHaveLength(1)
  })

  it("never refreshes a 401 from the refresh route itself", async () => {
    setTokens({ token: "old", refreshToken: "r1" })
    const expired = vi.fn()
    setOnAuthExpired(expired)
    const calls = serve(() => json({ detail: "Token tidak valid." }, { status: 401 }))
    const err = await apiRequest({ path: "/auth/refresh", method: "POST" }).catch((e: unknown) => e)
    expect(err).toMatchObject({ status: 401, message: "Token tidak valid." })
    expect(calls).toHaveLength(1)
    expect(expired).not.toHaveBeenCalled()
  })
})

describe("apiList", () => {
  it.each<[string, Record<string, string>, number]>([
    ["reads X-Total-Count", { "X-Total-Count": "42" }, 42],
    ["falls back to the row count without the header", {}, 2],
    ["falls back to the row count on a junk header", { "X-Total-Count": "banyak" }, 2],
  ])("%s", async (_name, headers, total) => {
    serve(() => json([{ id: 1 }, { id: 2 }], { headers }))
    await expect(apiList({ path: "/clients" })).resolves.toEqual({
      rows: [{ id: 1 }, { id: 2 }],
      total,
    })
  })

  it("treats an empty body as no rows", async () => {
    serve(() => new Response("", { status: 200 }))
    await expect(apiList({ path: "/clients" })).resolves.toEqual({ rows: [], total: 0 })
  })

  it("throws the problem detail on failure", async () => {
    serve(() => json({ detail: "Akses ditolak." }, { status: 403 }))
    await expect(apiList({ path: "/users" })).rejects.toMatchObject({
      status: 403,
      message: "Akses ditolak.",
    })
  })
})

describe("nullOn404", () => {
  it("maps only a 404 to null", async () => {
    await expect(nullOn404(async () => 5)).resolves.toBe(5)
    await expect(nullOn404(() => Promise.reject(new ApiError(404, null, "x")))).resolves.toBeNull()
    const forbidden = new ApiError(403, null, "x")
    await expect(nullOn404(() => Promise.reject(forbidden))).rejects.toBe(forbidden)
    const network = new TypeError("Failed to fetch")
    await expect(nullOn404(() => Promise.reject(network))).rejects.toBe(network)
  })
})

describe("buildQuery", () => {
  it.each<[string, Parameters<typeof buildQuery>[0], string]>([
    ["empty", {}, ""],
    ["skips blanks", { q: "", a: undefined, b: null, c: [] }, ""],
    ["joins arrays with commas", { status: ["draft", "sent"] }, "status=draft%2Csent"],
    ["stringifies scalars", { isActive: false, limit: 0 }, "isActive=false&limit=0"],
    ["encodes text", { q: "PT Maju & Jaya" }, "q=PT+Maju+%26+Jaya"],
  ])("%s", (_name, params, want) => {
    expect(buildQuery(params)).toBe(want)
  })
})

type SavedFile = { name: string; types: unknown; written: Blob[]; closed: boolean }

// File System Access API stand-in.
function stubPicker(fail?: Error) {
  const saved: SavedFile[] = []
  const picker = vi.fn(async (opts: { suggestedName: string; types?: unknown }) => {
    if (fail) throw fail
    const file: SavedFile = {
      name: opts.suggestedName,
      types: opts.types,
      written: [],
      closed: false,
    }
    saved.push(file)
    return {
      createWritable: async () => ({
        write: async (b: Blob) => {
          file.written.push(b)
        },
        close: async () => {
          file.closed = true
        },
      }),
    }
  })
  Object.defineProperty(window, "showSaveFilePicker", { value: picker, configurable: true })
  return saved
}

function dropPicker() {
  Reflect.deleteProperty(window, "showSaveFilePicker")
}

// Anchor fallback spy.
function spyAnchor() {
  const clicks: { href: string; download: string }[] = []
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    clicks.push({ href: this.href, download: this.download })
  })
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:gns/1")
  const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {})
  return { clicks, revoke }
}

describe("downloads", () => {
  afterEach(dropPicker)

  it.each<[string, (p: string, n: string) => Promise<void>, string, string]>([
    ["pdf", downloadPdf, "q.pdf", "application/pdf"],
    ["xml", downloadXml, "f.xml", "application/xml"],
    [
      "xlsx",
      downloadXlsx,
      "e.xlsx",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ],
  ])("%s saves through the picker with its own filter", async (_n, fn, name, mime) => {
    const saved = stubPicker()
    setTokens({ token: "tok" })
    const calls = serve(() => new Response("isi", { status: 200 }))
    await fn("/files/1", name)
    expect(header(calls[0], "authorization")).toBe("Bearer tok")
    expect(saved).toHaveLength(1)
    expect(saved[0].name).toBe(name)
    expect(saved[0].types).toEqual([
      { description: expect.any(String), accept: { [mime]: [`.${name.split(".")[1]}`] } },
    ])
    expect(await saved[0].written[0].text()).toBe("isi")
    expect(saved[0].closed).toBe(true)
  })

  it.each<[string, string]>([
    ["Laporan.PDF", "application/pdf"],
    ["data.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
    ["faktur.xml", "application/xml"],
    ["foto.png", "*/*"],
    ["tanpa-ekstensi", "*/*"],
  ])("downloadFile picks the filter from %s", async (name, mime) => {
    const saved = stubPicker()
    serve(() => new Response("x"))
    await downloadFile("/storage/x", name)
    const types = saved[0].types as { accept: Record<string, string[]> }[]
    expect(Object.keys(types[0].accept)).toEqual([mime])
  })

  it("surfaces a 409 detail written for the user", async () => {
    stubPicker()
    serve(() => json({ detail: "Surat jalan belum terbit." }, { status: 409 }))
    await expect(downloadPdf("/po/1/dn", "a.pdf")).rejects.toMatchObject({
      status: 409,
      message: "Surat jalan belum terbit.",
    })
  })

  it("hides an English download error behind Indonesian copy", async () => {
    serve(() => new Response("<html>gateway</html>", { status: 502 }))
    await expect(downloadPdf("/x", "a.pdf")).rejects.toMatchObject({
      status: 502,
      message: "Gagal mengunduh berkas.",
    })
  })
})

describe("saveBlob", () => {
  afterEach(dropPicker)

  it("does nothing more when the reader cancels the picker", async () => {
    stubPicker(new DOMException("cancelled", "AbortError"))
    const { clicks } = spyAnchor()
    await saveBlob(new Blob(["x"]), "a.pdf")
    expect(clicks).toEqual([])
  })

  it("falls back to a link when the picker fails for another reason", async () => {
    stubPicker(new DOMException("blocked", "SecurityError"))
    const { clicks } = spyAnchor()
    await saveBlob(new Blob(["x"]), "a.pdf")
    expect(clicks).toEqual([{ href: "blob:gns/1", download: "a.pdf" }])
  })

  it("downloads through a link without the picker and revokes it later", async () => {
    vi.useFakeTimers()
    const { clicks, revoke } = spyAnchor()
    await saveBlob(new Blob(["x"]), "rekap.xlsx")
    expect(clicks).toEqual([{ href: "blob:gns/1", download: "rekap.xlsx" }])
    expect(document.querySelector("a")).toBeNull()
    expect(revoke).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1000)
    expect(revoke).toHaveBeenCalledWith("blob:gns/1")
  })
})

describe("uploadAsset", () => {
  it("PUTs the file with its own type", async () => {
    const calls = serve(() => new Response(null, { status: 204 }))
    const file = new File(["x"], "a.png", { type: "image/png" })
    await uploadAsset("/storage/logo/a.png", file)
    expect(calls[0].init.method).toBe("PUT")
    expect(calls[0].init.body).toBe(file)
    expect(header(calls[0], "content-type")).toBe("image/png")
  })

  it("labels an untyped file as octet-stream", async () => {
    const calls = serve(() => new Response(null, { status: 204 }))
    await uploadAsset("/storage/x", new File(["x"], "a.bin"))
    expect(header(calls[0], "content-type")).toBe("application/octet-stream")
  })

  it("explains a refused file type", async () => {
    serve(() => json({ detail: "file type not allowed" }, { status: 400 }))
    await expect(uploadAsset("/storage/x", new File(["x"], "a.exe"))).rejects.toMatchObject({
      status: 400,
      message: "Jenis berkas tidak diizinkan.",
    })
  })
})

describe("fetchObjectUrl", () => {
  it("returns an object URL for the fetched image", async () => {
    spyAnchor()
    serve(() => new Response("png"))
    await expect(fetchObjectUrl("/clients/1/logo")).resolves.toBe("blob:gns/1")
  })

  it("throws the download copy on failure", async () => {
    serve(() => new Response("", { status: 404 }))
    await expect(fetchObjectUrl("/clients/1/logo")).rejects.toMatchObject({
      status: 404,
      message: "Gagal mengunduh berkas.",
    })
  })
})

describe("unreadable responses", () => {
  // Body that fails mid-read.
  const broken = (status: number) =>
    ({
      ok: false,
      status,
      headers: new Headers(),
      body: null,
      text: () => Promise.reject(new TypeError("network error")),
    }) as unknown as Response

  it("still reports a failed request whose body cannot be read", async () => {
    serve(() => broken(500))
    await expect(apiRequest({ path: "/x", authed: false })).rejects.toMatchObject({
      status: 500,
      body: null,
      message: "Permintaan gagal (500).",
    })
  })

  it("still reports a failed transfer whose body cannot be read", async () => {
    serve(() => broken(502))
    await expect(fetchObjectUrl("/x")).rejects.toMatchObject({
      status: 502,
      message: "Gagal mengunduh berkas.",
    })
  })

  it("reads a 204 list as empty", async () => {
    serve(() => new Response(null, { status: 204 }))
    await expect(apiList({ path: "/clients" })).resolves.toEqual({ rows: [], total: 0 })
  })

  it("uses the status text when a problem body says nothing", async () => {
    serve(() => json({ fields: { name: " " } }, { status: 400 }))
    await expect(apiRequest({ path: "/x", authed: false })).rejects.toMatchObject({
      message: "Permintaan gagal (400).",
    })
  })
})

describe("API base URL", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  async function pathFor(env: string | undefined): Promise<string> {
    vi.stubEnv("VITE_API_URL", env)
    vi.resetModules()
    const mod = await import("./api-client")
    const fetchMock = vi.fn(async () => json({}))
    vi.stubGlobal("fetch", fetchMock)
    await mod.apiRequest({ path: "/units", authed: false })
    return String((fetchMock.mock.calls[0] as unknown[])[0])
  }

  it.each<[string, string | undefined, string]>([
    ["same origin when unset", undefined, "/api/v1/units"],
    ["a configured host", "http://localhost:8080/api/v1", "http://localhost:8080/api/v1/units"],
    ["without a doubled slash", "https://gns.id/api/v1//", "https://gns.id/api/v1/units"],
  ])("targets %s", async (_name, env, want) => {
    expect(await pathFor(env)).toBe(want)
  })
})
