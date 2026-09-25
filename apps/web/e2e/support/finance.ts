import { randomBytes } from "node:crypto"
import { call, expectOk, generatePassword, type User } from "./api"

// Finance and admin spec data.
//
// Invoice and user data, built through the API. Every name carries a unique
// tag so parallel workers and reruns never collide. Quotations, POs and
// invoices have no DELETE route, so they stay behind; clients and users are
// deactivated by the spec that made them.

// Unique per call.
export function uniqueTag(): string {
  return `E2E-FA-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`
}

async function json<T>(res: Promise<Response>, what: string): Promise<T> {
  return (await (await expectOk(await res, what)).json()) as T
}

async function send(token: string, method: string, path: string, body?: unknown) {
  return expectOk(
    await call(path, {
      method,
      token,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    `${method} ${path}`,
  )
}

export type SeedClient = { id: number; name: string }

// Client passing the PO gate.
export async function createClient(token: string, tag: string): Promise<SeedClient> {
  const client = await json<SeedClient>(
    call("/clients", {
      method: "POST",
      token,
      body: JSON.stringify({
        name: `PT ${tag}`,
        npwp: "0123456789012345",
        address: "Jl. Pelabuhan No. 1, Jakarta",
        email: `${tag.toLowerCase()}@example.com`,
      }),
    }),
    "create client",
  )
  await send(token, "POST", `/clients/${client.id}/contacts`, {
    name: "Narahubung E2E",
    email: `pic.${tag.toLowerCase()}@example.com`,
  })
  return { id: client.id, name: client.name }
}

export async function deactivateClient(token: string, id: number): Promise<void> {
  const c = await json<Record<string, unknown>>(call(`/clients/${id}`, { token }), `get ${id}`)
  await send(token, "PUT", `/clients/${id}`, { ...c, isActive: false })
}

export type SeedInvoice = {
  id: number
  quotationId: number
  quotationNo: string
  invoiceNo: string
  poNumber?: string
  status: string
}

type InvoiceRow = SeedInvoice & { rowVersion: number }

// Quotation to delivered PO.
//
// Delivering the PO files the draft invoice, the only way one is made. The
// line carries its address, which the ON_PROGRESS gate requires.
export async function deliveredInvoice(token: string, client: SeedClient): Promise<SeedInvoice> {
  const units = await json<{ id: number }[]>(call("/units", { token }), "list units")
  const q = await json<{ id: number }>(
    call("/quotations", {
      method: "POST",
      token,
      body: JSON.stringify({
        companyClientId: client.id,
        discountPct: "0",
        items: [
          {
            requestedName: "Tali Tambat E2E",
            qty: "2",
            unitId: units[0].id,
            sellingPrice: "100000",
            costPrice: "60000",
            shipDestination: "Jl. Pelabuhan Raya No. 12, Tanjung Priok, Jakarta Utara",
          },
        ],
      }),
    }),
    "create quotation",
  )
  await send(token, "POST", `/quotations/${q.id}/send`)
  await send(token, "PATCH", `/quotations/${q.id}/status`, { status: "accepted" })
  const po = await json<{ id: number }>(
    call(`/purchase-orders/by-quotation/${q.id}`, { token }),
    "get PO",
  )
  // The key must sit directly in the PO's own folder.
  await send(token, "PATCH", `/purchase-orders/${po.id}/file`, {
    fileName: "po.pdf",
    fileSize: 1024,
    objectKey: `po/${po.id}/${Math.floor(Date.now() / 1000)}-po.pdf`,
  })
  for (const status of ["ON_PROGRESS", "DELIVERED"]) {
    await send(token, "PATCH", `/purchase-orders/${po.id}/status`, { status })
  }
  return invoiceOfQuotation(token, q.id)
}

// Newest invoice of a quotation.
export async function invoiceOfQuotation(token: string, quotationId: number): Promise<SeedInvoice> {
  const inv = await json<InvoiceRow>(
    call(`/invoices/by-quotation/${quotationId}`, { token }),
    "get invoice",
  )
  return {
    id: inv.id,
    quotationId: inv.quotationId,
    quotationNo: inv.quotationNo,
    invoiceNo: inv.invoiceNo,
    poNumber: inv.poNumber,
    status: inv.status,
  }
}

export async function setInvoiceStatus(
  token: string,
  id: number,
  status: "sent" | "paid" | "cancelled",
  note?: string,
): Promise<void> {
  await send(token, "PATCH", `/invoices/${id}/status`, { status, note })
}

// Raw invoice date PATCH.
//
// Dates are YYYY-MM-DD in WIB.
export async function patchInvoiceDates(
  token: string,
  id: number,
  invoiceDate: string,
  dueDate: string,
): Promise<Response> {
  const inv = await json<InvoiceRow>(call(`/invoices/${id}`, { token }), `get invoice ${id}`)
  return call(`/invoices/${id}/dates`, {
    method: "PATCH",
    token,
    headers: { "If-Match": String(inv.rowVersion) },
    body: JSON.stringify({
      invoiceDate: `${invoiceDate}T00:00:00+07:00`,
      dueDate: `${dueDate}T00:00:00+07:00`,
    }),
  })
}

export async function setInvoiceDates(
  token: string,
  id: number,
  invoiceDate: string,
  dueDate: string,
): Promise<void> {
  await expectOk(await patchInvoiceDates(token, id, invoiceDate, dueDate), `set dates ${id}`)
}

// WIB day, offset in days.
export function wibDay(offsetDays = 0): string {
  const ms = Date.now() + 7 * 3_600_000 + offsetDays * 86_400_000
  return new Date(ms).toISOString().slice(0, 10)
}

export type SeedUser = User & { password: string }

// Throwaway account for one test.
export async function createUser(
  token: string,
  role: "superadmin" | "operational" | "finance",
  tag: string,
): Promise<SeedUser> {
  const password = generatePassword()
  const user = await json<User>(
    call("/users", {
      method: "POST",
      token,
      body: JSON.stringify({
        email: `${tag.toLowerCase()}@globalsakti.com`,
        name: `Pengguna ${tag}`,
        role,
        password,
        isActive: true,
      }),
    }),
    "create user",
  )
  return { ...user, password }
}

export async function setUser(
  token: string,
  user: User,
  patch: Partial<Pick<User, "role" | "isActive" | "name">>,
): Promise<void> {
  const next = { ...user, ...patch }
  await send(token, "PUT", `/users/${user.id}`, {
    email: next.email,
    name: next.name,
    role: next.role,
    isActive: next.isActive,
  })
}

export async function resetPassword(token: string, id: number, password: string): Promise<void> {
  await send(token, "PATCH", `/users/${id}/password`, { password })
}
