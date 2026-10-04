import { randomBytes } from "node:crypto"
import { readFileSync } from "node:fs"
import type { InvoiceDetail, PurchaseOrderRow, QuotationDetail } from "../../src/types/generated"
import type { Tokens } from "./api"
import { apiURL, authFile } from "./env"

// Sales seeding through the API.
//
// Seeded as the superadmin. Every name carries the run prefix, so a spec
// finds its rows by searching for it and parallel workers never see each
// other's data.

export type ApiError = Error & { status: number; body: unknown }

export type SeedClient = {
  id: number
  name: string
  number: string
  contactId?: number
  contactEmail?: string
}
export type SeedVendor = { id: number; name: string }
// cost is the vendor link's harga beli, when linked.
export type SeedItem = {
  id: number
  name: string
  impaCode: string
  vendorProductId?: number
  cost?: number
}
// Catalog item or free text.
export type SeedLine = ({ item: SeedItem } | { freeText: string }) & {
  qty: number
  price: number
  cost?: number
  // Tidak Ditawarkan: sent unpriced, left out of the PO
  noOffer?: boolean
}
export type SeedQuotation = Pick<QuotationDetail, "id" | "quotationNo" | "version" | "status">

export type { QuotationDetail }

export type PurchaseOrder = PurchaseOrderRow

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE"

// Superadmin token saved by auth.setup.ts.
function adminToken(): string {
  return (JSON.parse(readFileSync(authFile("superadmin"), "utf8")) as Tokens).token
}

// Unique run-safe name prefix.
export function uniquePrefix(): string {
  return `E2E${randomBytes(4).toString("hex").toUpperCase()}`
}

// IMPA code no real item holds.
//
// Active codes are unique and the master data holds real six-digit ones, so
// a random six-digit code collides now and then. Twelve digits cannot hit
// a real one and stay numeric, as the product forms require.
export function uniqueImpa(): string {
  return String(10 ** 11 + Math.floor(Math.random() * 9 * 10 ** 11))
}

export async function api<T>(
  method: Method,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<T> {
  const res = await fetch(`${apiURL}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${adminToken()}`,
      "content-type": "application/json",
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  const parsed: unknown = text ? JSON.parse(text) : undefined
  if (!res.ok) {
    const err = new Error(`${method} ${path}: ${res.status} ${text}`) as ApiError
    err.status = res.status
    err.body = parsed
    throw err
  }
  return parsed as T
}

let unitIds: Map<string, number> | undefined

async function unitId(code: string): Promise<number> {
  if (!unitIds) {
    const units = await api<{ id: number; code: string }[]>("GET", "/units")
    unitIds = new Map(units.map((u) => [u.code, u.id]))
  }
  const id = unitIds.get(code)
  if (id === undefined) throw new Error(`unit ${code} is not seeded`)
  return id
}

type QuotationOpts = {
  client: SeedClient
  lines: SeedLine[]
  discountPct?: number
  shippingCost?: number
  notes?: string
  vesselName?: string
  validityDays?: number
  clientRefNo?: string
}

// Create and update body.
//
// A catalog line goes out sendable: its link's harga beli, or, for an item
// with no vendor link, fallbackVendor, which the server links on save.
async function quotationBody(
  opts: QuotationOpts,
  fallbackVendor?: number,
): Promise<Record<string, unknown>> {
  const pcs = await unitId("PCS")
  return {
    paymentTerms: "30 days",
    validityDays: opts.validityDays ?? 30,
    discountPct: String(opts.discountPct ?? 0),
    shippingAddress: "Jl. Pelabuhan Raya No. 12, Tanjung Priok, Jakarta Utara",
    shippingDays: 7,
    shippingCost: opts.shippingCost ? String(opts.shippingCost) : undefined,
    notes: opts.notes,
    vesselName: opts.vesselName,
    clientRefNo: opts.clientRefNo,
    items: opts.lines.map((l) => ({
      ...("item" in l
        ? {
            requestedItemId: l.item.id,
            requestedImpa: l.item.impaCode,
            requestedName: l.item.name,
            offeredItemId: l.item.id,
            vendorProductId: l.item.vendorProductId,
            vendorId: l.item.vendorProductId === undefined ? fallbackVendor : undefined,
          }
        : { requestedName: l.freeText }),
      qty: String(l.qty),
      unitId: pcs,
      sellingPrice: String(l.price),
      costPrice: String(
        l.cost ?? ("item" in l ? (l.item.cost ?? Math.max(1, Math.round(l.price / 2))) : 0),
      ),
      shipDestination: "Jl. Pelabuhan Raya No. 12, Tanjung Priok, Jakarta Utara",
      isAvailable: l.noOffer ? false : undefined,
    })),
  }
}

// Per-test rows, undone later.
export class SalesSeed {
  readonly prefix = uniquePrefix()
  private seq = 0
  private readonly clients: number[] = []
  private readonly vendors: number[] = []
  private readonly items: number[] = []
  private readonly quotations: number[] = []

  // Prefixed name, unique per call.
  name(label: string): string {
    this.seq += 1
    return `${this.prefix} ${label} ${this.seq}`
  }

  // Client, complete by default.
  //
  // A complete client passes the PO completeness gate.
  async client(
    opts: { complete?: boolean; label?: string; name?: string } = {},
  ): Promise<SeedClient> {
    const complete = opts.complete ?? true
    const name = opts.name ?? this.name(opts.label ?? "Klien")
    const created = await api<{ id: number; number: string }>("POST", "/clients", {
      name,
      countryCode: "IDN",
      npwp: complete ? "0123456789012345" : null,
      address: complete ? "Jl. Pelabuhan Raya No. 12, Tanjung Priok, Jakarta Utara" : null,
      email: null,
      tkuId: null,
    })
    this.clients.push(created.id)
    let contactId: number | undefined
    // Contact emails are unique across every client.
    const contactEmail = complete
      ? `${this.prefix.toLowerCase()}.${this.seq}@example.com`
      : undefined
    if (complete) {
      const contact = await api<{ id: number }>("POST", `/clients/${created.id}/contacts`, {
        name: `${this.prefix} Narahubung`,
        email: contactEmail,
        phone: "81234567890",
        title: "Purchasing",
        countryCode: "IDN",
      })
      contactId = contact.id
    }
    return { id: created.id, name, number: created.number, contactId, contactEmail }
  }

  async vendor(opts: { complete?: boolean; label?: string } = {}): Promise<SeedVendor> {
    const complete = opts.complete ?? true
    const name = this.name(opts.label ?? "Vendor")
    const created = await api<{ id: number }>("POST", "/vendors", {
      name,
      location: complete ? "Surabaya" : null,
      contactInfo: complete ? { email: "vendor@example.com", phone: "81298765432" } : {},
    })
    this.vendors.push(created.id)
    return { id: created.id, name }
  }

  // Catalog item, optionally vendor-linked.
  async item(opts: { vendor?: SeedVendor; cost?: number; label?: string } = {}): Promise<SeedItem> {
    const name = this.name(opts.label ?? "Produk")
    const impaCode = uniqueImpa()
    const created = await api<{ id: number }>("POST", "/items", {
      name,
      impaCode,
      defaultUnitId: await unitId("PCS"),
      description: null,
    })
    this.items.push(created.id)
    let vendorProductId: number | undefined
    if (opts.vendor) {
      const link = await api<{ id?: number; vendorProductId?: number }>(
        "POST",
        `/items/${created.id}/vendors`,
        {
          vendorId: opts.vendor.id,
          vendorSku: `${this.prefix}-SKU`,
          costPrice: String(opts.cost ?? 100000),
          productUrl: null,
        },
      )
      vendorProductId = link.vendorProductId ?? link.id
    }
    const cost = opts.vendor ? (opts.cost ?? 100000) : undefined
    return { id: created.id, name, impaCode, vendorProductId, cost }
  }

  // Extra contact for a client.
  async contact(client: SeedClient, name: string): Promise<number> {
    const created = await api<{ id: number }>("POST", `/clients/${client.id}/contacts`, {
      name,
      email: `${this.prefix.toLowerCase()}.k${++this.seq}@example.com`,
      phone: "81355500011",
      countryCode: "IDN",
    })
    return created.id
  }

  // Extra vendor offer for item.
  async linkVendor(item: SeedItem, vendor: SeedVendor, cost: number): Promise<void> {
    await api("POST", `/items/${item.id}/vendors`, {
      vendorId: vendor.id,
      costPrice: String(cost),
    })
  }

  // Draft quotation, priced lines.
  //
  // The shipping address stores a line even at a zero charge, and each line
  // carries the address too, so the ON_PROGRESS gate passes either way.
  private fallbackVendor?: SeedVendor

  // Vendor for unlinked catalog lines.
  // Created once per test, and only when a line needs it.
  private async fallbackVendorFor(opts: QuotationOpts): Promise<number | undefined> {
    const needed = opts.lines.some((l) => "item" in l && l.item.vendorProductId === undefined)
    if (!needed) return undefined
    this.fallbackVendor ??= await this.vendor({ label: "Vendor Cadangan" })
    return this.fallbackVendor.id
  }

  async quotation(opts: QuotationOpts): Promise<QuotationDetail> {
    const created = await api<{ id: number }>("POST", "/quotations", {
      companyClientId: opts.client.id,
      contactId: opts.client.contactId,
      ...(await quotationBody(opts, await this.fallbackVendorFor(opts))),
    })
    this.quotations.push(created.id)
    return this.getQuotation(created.id)
  }

  // Save as another user would.
  //
  // Bumps rowVersion, so an editor opened earlier holds a stale version.
  async updateQuotation(q: QuotationDetail, opts: QuotationOpts): Promise<void> {
    await api(
      "PUT",
      `/quotations/${q.id}`,
      await quotationBody(opts, await this.fallbackVendorFor(opts)),
      {
        "If-Match": String(q.rowVersion),
      },
    )
  }

  getQuotation(id: number): Promise<QuotationDetail> {
    return api<QuotationDetail>("GET", `/quotations/${id}`)
  }

  async send(id: number): Promise<void> {
    await api("POST", `/quotations/${id}/send`)
  }

  async setQuotationStatus(id: number, status: string, note?: string): Promise<void> {
    await api("PATCH", `/quotations/${id}/status`, { status, note })
  }

  // Send, accept, return PO.
  async accept(id: number): Promise<PurchaseOrder> {
    await this.send(id)
    await this.setQuotationStatus(id, "accepted")
    return this.poByQuotation(id)
  }

  async revise(id: number, note?: string): Promise<number> {
    const { id: draft } = await api<{ id: number }>("POST", `/quotations/${id}/revise`, { note })
    this.quotations.push(draft)
    return draft
  }

  poByQuotation(quotationId: number): Promise<PurchaseOrder> {
    return api<PurchaseOrder>("GET", `/purchase-orders/by-quotation/${quotationId}`)
  }

  attachPoFile(po: PurchaseOrder, fileName = "po-klien.pdf"): Promise<void> {
    return uploadPoFile(adminToken(), po.id, fileName)
  }

  // Deliver a PO fully.
  //
  // File, work, delivery; the server files a draft invoice.
  async deliver(po: PurchaseOrder): Promise<InvoiceDetail> {
    await this.attachPoFile(po)
    await this.setPoStatus(po.id, "ON_PROGRESS")
    await this.setPoStatus(po.id, "DELIVERED")
    return api("GET", `/invoices/by-quotation/${po.quotationId}`)
  }

  async setPoNotes(poId: number, notes: string): Promise<void> {
    await api("PATCH", `/purchase-orders/${poId}/notes`, { notes })
  }

  async setPoStatus(poId: number, status: string, note?: string): Promise<void> {
    await api("PATCH", `/purchase-orders/${poId}/status`, { status, note })
  }

  // Undo what the test created.
  //
  // Cancels what is still open, then deactivates the master rows.
  async cleanup(): Promise<void> {
    const note = "Pembersihan data e2e"
    for (const id of [...this.quotations].reverse()) {
      const q = await this.getQuotation(id).catch(() => null)
      if (!q) continue
      if (q.status === "accepted") {
        const po = await this.poByQuotation(id).catch(() => null)
        if (po?.allowedTransitions.some((t) => t.to === "CANCELLED")) {
          await this.setPoStatus(po.id, "CANCELLED", note)
        } else if (po?.status === "DELIVERED") {
          // Delivery filed an invoice; void it while it is open.
          const inv = await api<{ id: number; status: string }>(
            "GET",
            `/invoices/by-quotation/${id}`,
          ).catch(() => null)
          if (inv && ["draft", "sent", "overdue"].includes(inv.status)) {
            await api("PATCH", `/invoices/${inv.id}/status`, { status: "cancelled", note })
          }
        }
      } else if (q.allowedTransitions.some((t) => t.to === "cancelled")) {
        await this.setQuotationStatus(id, "cancelled", note)
      }
    }
    for (const id of this.items) await deactivate("item", id)
    for (const id of this.vendors) await deactivate("vendor", id)
    for (const id of this.clients) await deactivate("client", id)
  }

  // Track a UI-created row.
  //
  // Found through the list search by its exact name.
  // Newest quotation a page made.
  // Tracked so it is cleaned up like a seeded one.
  async adoptNewestQuotation(client: SeedClient): Promise<number> {
    const rows = await api<{ id: number; companyName: string }[]>(
      "GET",
      `/quotations?q=${encodeURIComponent(client.name)}`,
    )
    const ids = rows.filter((r) => r.companyName === client.name).map((r) => r.id)
    if (ids.length === 0) throw new Error(`no quotation for ${client.name}`)
    const id = Math.max(...ids)
    if (!this.quotations.includes(id)) this.quotations.push(id)
    return id
  }

  async adopt(kind: "client" | "vendor" | "item", name: string): Promise<number> {
    const path = { client: "/clients", vendor: "/vendors", item: "/items" }[kind]
    const rows = await api<{ id: number; name: string }[]>(
      "GET",
      `${path}?q=${encodeURIComponent(name)}`,
    )
    const row = rows.find((r) => r.name === name)
    if (!row) throw new Error(`${kind} ${name} was not created`)
    this.track(kind, row.id)
    return row.id
  }

  // Track a row for cleanup.
  track(kind: "client" | "vendor" | "item" | "quotation", id: number): void {
    const list = {
      client: this.clients,
      vendor: this.vendors,
      item: this.items,
      quotation: this.quotations,
    }[kind]
    if (!list.includes(id)) list.push(id)
  }
}

// Rupiah as detail pages print.
export function rupiah(n: number): string {
  return `Rp${n.toLocaleString("id-ID")}`
}

// Numeric id from a path.
export function idFrom(href: string | null): number {
  const m = href?.match(/\/(\d+)(?:\/[a-z]+)?\/?$/)
  if (!m) throw new Error(`no id in ${href}`)
  return Number(m[1])
}

// Smallest PDF the policy accepts.
const pdfText =
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n"

// Attach a PDF to PO.
//
// The app's own path: presign, PUT through the storage proxy, then attach.
// PENDING becomes UPLOADED. The server refuses a key with no upload behind
// it, so the object must really exist.
export async function uploadPoFile(
  token: string,
  poId: number,
  fileName = "po-klien.pdf",
): Promise<void> {
  const authed = async (what: string, path: string, init: RequestInit, type: string) => {
    const res = await fetch(`${apiURL}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${token}`, "content-type": type },
    })
    if (!res.ok) throw new Error(`${what}: ${res.status} ${await res.text()}`)
    return res
  }
  const presign = (await (
    await authed(
      "presign PO file",
      `/purchase-orders/${poId}/upload-url?fileName=${encodeURIComponent(fileName)}`,
      {},
      "application/json",
    )
  ).json()) as { uploadUrl: string; objectKey: string }
  await authed(
    `upload ${fileName}`,
    presign.uploadUrl,
    { method: "PUT", body: pdfText },
    "application/pdf",
  )
  await authed(
    "attach PO file",
    `/purchase-orders/${poId}/file`,
    {
      method: "PATCH",
      body: JSON.stringify({
        fileName,
        fileSize: Buffer.byteLength(pdfText),
        objectKey: presign.objectKey,
      }),
    },
    "application/json",
  )
}

// PDF payload for file inputs.
export function pdfFile(name: string): { name: string; mimeType: string; buffer: Buffer } {
  return { name, mimeType: "application/pdf", buffer: Buffer.from(pdfText) }
}

// Deactivate a master row.
//
// Master data has no delete endpoint; deactivation is the undo.
export async function deactivate(kind: "client" | "vendor" | "item", id: number): Promise<void> {
  const path = `${{ client: "/clients", vendor: "/vendors", item: "/items" }[kind]}/${id}`
  const row = await api<Record<string, unknown>>("GET", path)
  await api("PUT", path, { ...row, isActive: false })
}
