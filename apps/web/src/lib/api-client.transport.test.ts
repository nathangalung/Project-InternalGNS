// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  ApiError,
  apiList,
  apiRequest,
  buildQuery,
  downloadFile,
  downloadPdf,
  downloadXlsx,
  downloadXml,
  fetchObjectUrl,
  nullOn404,
  postForm,
  saveBlob,
  uploadAsset,
} from "./api-client"
import { endSession, getAccessToken, isSignedIn, signIn } from "./session"

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

beforeEach(() => {
  sessionStorage.clear()
  endSession()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe("apiRequest", () => {
  it("sends the in-memory bearer token, JSON body and extra headers", async () => {
    signIn("tok")
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
    // Credentialed, so a revocation's Set-Cookie lands cross-origin.
    expect(calls[0].init.credentials).toBe("include")
    expect(sessionStorage.length).toBe(0)
  })

  it("defaults to GET with no body and no token", async () => {
    const calls = serve(() => json([]))
    await apiRequest({ path: "/units" })
    expect(calls[0].init.method).toBe("GET")
    expect(calls[0].init.body).toBeUndefined()
    expect(header(calls[0], "authorization")).toBeNull()
  })

  // AU-4: credentials skip stale tokens.
  it("leaves the token off a credential call", async () => {
    signIn("stale")
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

  // AU-7: plain-text rate-limit answer.
  it("turns a plain-text 429 into a typed error, not a JSON crash", async () => {
    serve(() => new Response("Too Many Requests", { status: 429 }))
    const err = await apiRequest({ path: "/auth/login", authed: false }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ status: 429, body: null, message: "Permintaan gagal (429)." })
  })

  it("keeps the problem body on the error", async () => {
    const problem = {
      type: "about:blank",
      title: "Conflict",
      status: 409,
      detail: "Nomor PO sudah dipakai.",
    }
    serve(() => json(problem, { status: 409 }))
    const err = await apiRequest({ path: "/x", authed: false }).catch((e: unknown) => e)
    expect(err).toMatchObject({ status: 409, body: problem, message: "Nomor PO sudah dipakai." })
  })
})

describe("session refresh", () => {
  const refused = () => new Response("", { status: 401 })

  it("refreshes once on a 401 and replays the request with the new token", async () => {
    signIn("old")
    const calls = serve((path, init) => {
      if (path === "/auth/refresh") return json({ token: "new", expiresAt: 0 })
      return new Headers(init.headers).get("authorization") === "Bearer new"
        ? json({ ok: true })
        : refused()
    })
    await expect(apiRequest({ path: "/users" })).resolves.toEqual({ ok: true })
    expect(calls.map((c) => c.path)).toEqual(["/users", "/auth/refresh", "/users"])
    expect(calls[1].init.credentials).toBe("include")
    expect(header(calls[1], "X-GNS-CSRF")).toBe("1")
    expect(calls[1].init.body).toBeUndefined()
    expect(getAccessToken()).toBe("new")
  })

  it("retries only once: a second 401 is the answer", async () => {
    signIn("old")
    const calls = serve((path) =>
      path === "/auth/refresh" ? json({ token: "new", expiresAt: 0 }) : refused(),
    )
    const err = await apiRequest({ path: "/users" }).catch((e: unknown) => e)
    expect(err).toMatchObject({ status: 401 })
    expect(calls.map((c) => c.path)).toEqual(["/users", "/auth/refresh", "/users"])
  })

  it("shares one refresh between parallel 401s", async () => {
    signIn("old")
    const calls = serve((path, init) => {
      if (path === "/auth/refresh") return json({ token: "new", expiresAt: 0 })
      const auth = new Headers(init.headers).get("authorization")
      return auth === "Bearer new" ? json(path) : refused()
    })
    const out = await Promise.all([apiRequest({ path: "/a" }), apiRequest({ path: "/b" })])
    expect(out).toEqual(["/a", "/b"])
    expect(calls.filter((c) => c.path === "/auth/refresh")).toHaveLength(1)
  })

  it("replays with a newer token another request already fetched", async () => {
    signIn("old")
    const calls = serve((path, init) => {
      if (new Headers(init.headers).get("authorization") === "Bearer old") {
        // The session rotates while this request is refused.
        signIn("peer")
        return refused()
      }
      return json(path)
    })
    await expect(apiRequest({ path: "/a" })).resolves.toBe("/a")
    expect(calls.map((c) => c.path)).toEqual(["/a", "/a"])
    expect(header(calls[1], "authorization")).toBe("Bearer peer")
  })

  it.each<[string, Handler]>([
    ["the cookie is refused", (path) => (path === "/auth/refresh" ? refused() : refused())],
    [
      "the API is unreachable",
      (path) => (path === "/auth/refresh" ? Promise.reject(new TypeError("offline")) : refused()),
    ],
  ])("ends the session when %s", async (_name, handler) => {
    signIn("old")
    const calls = serve(handler)
    const err = await apiRequest({ path: "/users" }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ status: 401, message: "Sesi berakhir, silakan masuk kembali." })
    expect(isSignedIn()).toBe(false)
    expect(calls.filter((c) => c.path === "/users")).toHaveLength(1)
  })

  it("never refreshes a credential call's 401", async () => {
    const calls = serve(() => refused())
    const err = await apiRequest({ path: "/auth/login", method: "POST", authed: false }).catch(
      (e: unknown) => e,
    )
    expect(err).toMatchObject({ status: 401 })
    expect(calls).toHaveLength(1)
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
    serve(() =>
      json(
        { type: "about:blank", title: "Forbidden", status: 403, detail: "Akses ditolak." },
        { status: 403 },
      ),
    )
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
    signIn("tok")
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
    serve(() =>
      json(
        {
          type: "about:blank",
          title: "Conflict",
          status: 409,
          detail: "Surat jalan belum terbit.",
        },
        { status: 409 },
      ),
    )
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

describe("postForm", () => {
  it("POSTs the form and lets the browser set the boundary", async () => {
    const calls = serve(() => json({ rows: [] }))
    const form = new FormData()
    form.append("file", new File(["x"], "a.xlsx"))
    await expect(postForm("/quotations/rfq", form)).resolves.toEqual({ rows: [] })
    expect(calls[0].path).toBe("/quotations/rfq")
    expect(calls[0].init.method).toBe("POST")
    expect(calls[0].init.body).toBe(form)
    expect(header(calls[0], "content-type")).toBeNull()
  })

  it("surfaces the server detail", async () => {
    serve(() =>
      json(
        { status: 422, title: "Unprocessable Entity", detail: "Berkas kosong." },
        { status: 422 },
      ),
    )
    await expect(postForm("/quotations/rfq", new FormData())).rejects.toMatchObject({
      status: 422,
      message: "Berkas kosong.",
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
