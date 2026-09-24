import { randomBytes } from "node:crypto"
import { readFileSync } from "node:fs"
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
export type SeedItem = { id: number; name: string; impaCode: string; vendorProductId?: number }
export type SeedLine = { item: SeedItem; qty: number; price: number; cost?: number }
export type SeedQuotation = { id: number; quotationNo: string; version: number; status: string }

export type Transition = { to: string; label: string; requiresNote: boolean }

export type QuotationDetail = SeedQuotation & {
  contactId?: number
  companyClientId: number
  grandTotal: string
  notes?: string
  vesselName?: string
  allowedTransitions: Transition[]
  canRevise: boolean
}

export type PurchaseOrder = {
  id: number
  poNumber: string
  quotationId: number
  quotationNo: string
  companyClientId: number
  status: string
  fileName?: string
  notes?: string
  discountPct: string
  poTotalProduk: string
  poGrandTotal: string
  deliveryNoteNumber?: string
  rowVersion: number
  allowedTransitions: Transition[]
}

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE"

// Superadmin token saved by auth.setup.ts.
function adminToken(): string {
  return (JSON.parse(readFileSync(authFile("superadmin"), "utf8")) as Tokens).token
}

// Unique run-safe name prefix.
export function uniquePrefix(): string {
  return `E2E${randomBytes(4).toString("hex").toUpperCase()}`
}

export async function api<T>(method: Method, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${apiURL}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${adminToken()}`,
      "content-type": "application/json",
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
  async client(opts: { complete?: boolean; label?: string } = {}): Promise<SeedClient> {
    const complete = opts.complete ?? true
    const name = this.name(opts.label ?? "Klien")
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
    const impaCode = String(100000 + Math.floor(Math.random() * 899999))
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
    return { id: created.id, name, impaCode, vendorProductId }
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
  async quotation(opts: {
    client: SeedClient
    lines: SeedLine[]
    discountPct?: number
    shippingCost?: number
    notes?: string
    vesselName?: string
  }): Promise<SeedQuotation> {
    const pcs = await unitId("PCS")
    const created = await api<{ id: number }>("POST", "/quotations", {
      companyClientId: opts.client.id,
      contactId: opts.client.contactId,
      paymentTerms: "30 days",
      validityDays: 30,
      discountPct: String(opts.discountPct ?? 0),
      shippingAddress: "Jl. Pelabuhan Raya No. 12, Tanjung Priok, Jakarta Utara",
      shippingDays: 7,
      shippingCost: opts.shippingCost ? String(opts.shippingCost) : undefined,
      notes: opts.notes,
      vesselName: opts.vesselName,
      items: opts.lines.map((l) => ({
        requestedItemId: l.item.id,
        requestedImpa: l.item.impaCode,
        requestedName: l.item.name,
        offeredItemId: l.item.id,
        vendorProductId: l.item.vendorProductId,
        qty: String(l.qty),
        unitId: pcs,
        sellingPrice: String(l.price),
        costPrice: l.cost === undefined ? undefined : String(l.cost),
      })),
    })
    this.quotations.push(created.id)
    return this.getQuotation(created.id)
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

  // Attach a PDF to PO.
  //
  // PENDING becomes UPLOADED. The presigned path is relative to the API base.
  async attachPoFile(po: PurchaseOrder, fileName = "po-klien.pdf"): Promise<void> {
    const presign = await api<{ uploadUrl: string; objectKey: string }>(
      "GET",
      `/purchase-orders/${po.id}/upload-url?fileName=${encodeURIComponent(fileName)}`,
    )
    const size = Buffer.byteLength(pdfText)
    const res = await fetch(`${apiURL}${presign.uploadUrl}`, {
      method: "PUT",
      headers: { authorization: `Bearer ${adminToken()}`, "content-type": "application/pdf" },
      body: pdfText,
    })
    if (!res.ok) throw new Error(`upload ${fileName}: ${res.status} ${await res.text()}`)
    await api("PATCH", `/purchase-orders/${po.id}/file`, {
      fileName,
      fileSize: size,
      objectKey: presign.objectKey,
    })
  }

  // Deliver a PO fully.
  //
  // File, work, delivery; the server files a draft invoice.
  async deliver(po: PurchaseOrder): Promise<{ id: number; status: string }> {
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
