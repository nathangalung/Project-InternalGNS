import { beforeEach, describe, expect, it, vi } from "vitest"
import { apiList, apiRequest } from "@/lib/api-client"
import * as api from "./api"

vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  apiRequest: vi.fn(async () => undefined),
  apiList: vi.fn(async () => ({ rows: [], total: 0 })),
  downloadPdf: vi.fn(async () => {}),
  downloadXlsx: vi.fn(async () => {}),
  getRefreshToken: vi.fn(() => null),
}))

describe("clients api", () => {
  beforeEach(() => vi.clearAllMocks())

  it.each<[string, api.ClientListParams | undefined, string]>([
    ["no params", undefined, "/clients"],
    [
      "every filter",
      {
        q: "samudera",
        isActive: true,
        countryCode: "ID",
        minTotal: "1000",
        sortBy: "totalPurchase",
        sortDir: "desc",
        limit: 10,
        offset: 20,
      },
      "/clients?q=samudera&isActive=true&countryCode=ID&minTotal=1000&sortBy=totalPurchase&sortDir=desc&limit=10&offset=20",
    ],
  ])("lists with %s", async (_name, params, path) => {
    await api.list(params)
    expect(apiList).toHaveBeenCalledWith({ path })
  })

  it.each<[string, () => Promise<unknown>, Parameters<typeof apiRequest>[0]]>([
    ["summary", () => api.summary(), { path: "/clients/summary" }],
    ["get", () => api.get(7), { path: "/clients/7" }],
    [
      "search",
      () => api.search("pt a", { minScore: 0.3, limit: 5 }),
      { path: "/clients/search?q=pt+a&minScore=0.3&limit=5" },
    ],
    ["search without options", () => api.search("b"), { path: "/clients/search?q=b" }],
    [
      "create",
      () => api.create({ name: "PT A" }),
      { path: "/clients", method: "POST", body: { name: "PT A" } },
    ],
    [
      "update",
      () => api.update(7, { name: "PT A", countryCode: "ID", isActive: false }),
      {
        path: "/clients/7",
        method: "PUT",
        body: { name: "PT A", countryCode: "ID", isActive: false },
      },
    ],
    ["list contacts", () => api.listContacts(7), { path: "/clients/7/contacts" }],
    [
      "create contact",
      () => api.createContact(7, { name: "Budi" }),
      { path: "/clients/7/contacts", method: "POST", body: { name: "Budi" } },
    ],
    [
      "update contact",
      () => api.updateContact(7, 3, { name: "Budi", email: "", countryCode: "ID" }),
      {
        path: "/clients/7/contacts/3",
        method: "PATCH",
        body: { name: "Budi", email: "", countryCode: "ID" },
      },
    ],
    [
      "delete contact",
      () => api.deleteContact(7, 3),
      { path: "/clients/7/contacts/3", method: "DELETE" },
    ],
    [
      "presign logo upload",
      () => api.presignLogoUpload(7, "logo baru.png"),
      { path: "/clients/7/logo/upload-url?fileName=logo+baru.png" },
    ],
    [
      "presign logo download",
      () => api.presignLogoDownload(7),
      { path: "/clients/7/logo/download-url" },
    ],
    [
      "save logo key",
      () => api.updateLogo(7, "clients/7/a.png"),
      { path: "/clients/7/logo", method: "PATCH", body: { objectKey: "clients/7/a.png" } },
    ],
  ])("%s", async (_name, call, want) => {
    await call()
    expect(apiRequest).toHaveBeenCalledWith(want)
  })
})
