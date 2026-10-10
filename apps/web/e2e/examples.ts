import { mkdirSync, writeFileSync } from "node:fs"
import type {
  InvoiceDetail,
  PurchaseOrderRow,
  QuotationCreated,
  QuotationDetail,
  UnitRow,
} from "../src/types/generated"
import { call, expectOk, login } from "./support/api"
import { adminCredentials, apiURL } from "./support/env"
import { uploadPoFile } from "./support/sales"

// Export examples generator.
//
// Walks one invented sale through the API, quotation to paid invoice, and
// saves one file of every export into docs/example. Run by `make examples`
// against its own throwaway database, never against real data: the
// repository is public and every name, number and amount here is made up.

const outDir = new URL("../../../docs/example/", import.meta.url)

type Saved = { file: string; route: string; what: string }
const saved: Saved[] = []

async function json<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const res = await expectOk(
    await call(path, { ...init, token }),
    `${init.method ?? "GET"} ${path}`,
  )
  return (await res.json()) as T
}

function post<T>(token: string, path: string, body?: unknown, method = "POST"): Promise<T> {
  return json<T>(path, token, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

async function download(token: string, route: string, file: string, what: string) {
  const res = await expectOk(
    await fetch(`${apiURL}${route}`, { headers: { authorization: `Bearer ${token}` } }),
    `download ${route}`,
  )
  const body = new Uint8Array(await res.arrayBuffer())
  if (body.length === 0) throw new Error(`${route} returned an empty file`)
  writeFileSync(new URL(file, outDir), body)
  saved.push({ file, route: route.replace(/\/\d+\//, "/{id}/"), what })
}

function wibToday(): string {
  return new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10)
}

async function main() {
  const { email, password } = adminCredentials()
  const { token } = await login(email, password)
  const units = await json<UnitRow[]>("/units", token)
  const unit = (code: string) => {
    const u = units.find((x) => x.code === code)
    if (!u) throw new Error(`unit ${code} missing from the master data`)
    return u.id
  }

  const client = await post<{ id: number; name: string }>(token, "/clients", {
    name: "PT Samudra Contoh Nusantara",
    npwp: "0123456789012345",
    tkuId: "0123456789012345000000",
    address: "Jl. Pelabuhan Raya No. 12, Tanjung Priok, Jakarta Utara 14310",
    email: "procurement@samudracontoh.example.com",
  })
  const contact = await post<{ id: number }>(token, `/clients/${client.id}/contacts`, {
    name: "Rina Kartika",
    title: "Purchasing",
    email: "rina.kartika@samudracontoh.example.com",
    phone: "81234567890",
  })

  const vendors = await Promise.all(
    [
      { name: "CV Sumber Teknik Contoh", location: "Surabaya", phone: "81311112222" },
      { name: "PT Bahari Suplai Contoh", location: "Jakarta Utara", phone: "81333334444" },
    ].map((v) =>
      post<{ id: number }>(token, "/vendors", {
        name: v.name,
        location: v.location,
        contactInfo: { email: "sales@vendorcontoh.example.com", phone: v.phone },
      }),
    ),
  )

  const lines = [
    {
      name: "Tali Tambat Polypropylene 24 mm",
      impa: "210101",
      unit: "COIL",
      qty: "2",
      cost: "1850000",
      sell: "2400000",
      vendor: 0,
    },
    {
      name: "Sarung Tangan Kerja Katun",
      impa: "190105",
      unit: "PKT",
      qty: "10",
      cost: "45000",
      sell: "65000",
      vendor: 1,
    },
    {
      name: "Cat Anti Karat Merah 5 Liter",
      impa: "250201",
      unit: "TIN",
      qty: "6",
      cost: "410000",
      sell: "525000",
      vendor: 1,
    },
    {
      name: "Lampu Navigasi LED 24V",
      impa: "370612",
      unit: "PCS",
      qty: "4",
      cost: "1275000",
      sell: "1690000",
      vendor: 0,
    },
    {
      name: "Kabel Listrik NYY 3 x 2,5 mm",
      impa: "350831",
      unit: "MTR",
      qty: "100",
      cost: "18500",
      sell: "24000",
      vendor: 0,
    },
  ]
  const items = await Promise.all(
    lines.map((l) =>
      post<{ id: number }>(token, "/items", {
        name: l.name,
        impaCode: l.impa,
        defaultUnitId: unit(l.unit),
      }),
    ),
  )

  const q = await post<QuotationCreated>(token, "/quotations", {
    companyClientId: client.id,
    contactId: contact.id,
    clientRefNo: "RFQ/SCN/2026/0142",
    vesselName: "MV Bahari Contoh",
    paymentTerms: "30 days after invoice",
    validityDays: 30,
    discountPct: "5",
    shippingAddress: "Gudang Pelabuhan Tanjung Priok, Jl. Pelabuhan Raya No. 12, Jakarta Utara",
    shippingDays: 7,
    shippingCost: "750000",
    items: lines.map((l, i) => ({
      requestedName: l.name,
      requestedImpa: l.impa,
      offeredItemId: items[i].id,
      vendorId: vendors[l.vendor].id,
      qty: l.qty,
      unitId: unit(l.unit),
      sellingPrice: l.sell,
      costPrice: l.cost,
    })),
  })
  await post(token, `/quotations/${q.id}/send`)
  const quotation = await json<QuotationDetail>(`/quotations/${q.id}`, token)
  // The quotation as the client received it.
  await download(token, `/quotations/${q.id}/pdf`, "quotation.pdf", "Quotation PDF")

  await post(token, `/quotations/${q.id}/status`, { status: "accepted" }, "PATCH")
  const po = await json<PurchaseOrderRow>(`/purchase-orders/by-quotation/${q.id}`, token)
  await uploadPoFile(token, po.id)
  // The upload moved the row version.
  const filed = await json<PurchaseOrderRow>(`/purchase-orders/by-quotation/${q.id}`, token)
  await expectOk(
    await call(`/purchase-orders/${po.id}/details`, {
      method: "PATCH",
      token,
      headers: { "If-Match": String(filed.rowVersion) },
      body: JSON.stringify({ poNumber: "PO/SCN/2026/0088", poDate: wibToday() }),
    }),
    "PATCH details",
  )
  for (const status of ["ON_PROGRESS", "DELIVERED"]) {
    await post(token, `/purchase-orders/${po.id}/status`, { status }, "PATCH")
  }
  await download(
    token,
    `/purchase-orders/${po.id}/delivery-note.pdf`,
    "delivery-note.pdf",
    "Surat Jalan (delivery note) PDF",
  )

  const invoice = await json<InvoiceDetail>(`/invoices/by-quotation/${q.id}`, token)
  await post(token, `/invoices/${invoice.id}/status`, { status: "sent" }, "PATCH")
  await download(token, `/invoices/${invoice.id}/pdf`, "invoice.pdf", "Invoice PDF")
  await download(
    token,
    `/invoices/${invoice.id}/coretax.xml`,
    "coretax-faktur.xml",
    "Coretax XML of one invoice",
  )

  for (const entry of [
    {
      direction: "in",
      category: "Setoran Modal",
      amount: "25000000",
      description: "Setoran modal kerja contoh",
    },
    {
      direction: "out",
      category: "Sewa Kantor",
      amount: "4500000",
      description: "Sewa kantor bulan ini",
    },
  ]) {
    await post(token, "/cash-entries", { entryDate: wibToday(), ...entry })
  }

  await download(
    token,
    "/quotations/export.xlsx",
    "quotation-export.xlsx",
    "Quotation list (Ekspor Excel)",
  )
  await download(
    token,
    "/purchase-orders/export.xlsx",
    "delivery-note-export.xlsx",
    "PO and delivery note list (Ekspor Excel)",
  )
  await download(
    token,
    "/invoices/export.xlsx",
    "invoice-export.xlsx",
    "Invoice list (Ekspor Excel), the payment reminder source",
  )
  await download(
    token,
    "/invoices/coretax.xlsx",
    "coretax-export.xlsx",
    "Coretax bulk import workbook",
  )
  await download(
    token,
    "/dashboard/export.xlsx",
    "dashboard-export.xlsx",
    "Financial dashboard (Ekspor Excel)",
  )
  await download(token, "/cash-entries/export.xlsx", "kas-lain.xlsx", "Kas Lain (Ekspor Excel)")

  writeFileSync(new URL("README.md", outDir), readme(quotation.quotationNo, invoice.invoiceNo))
  for (const s of saved) console.log(`${s.file}  ${s.route}`)
}

function readme(quotationNo: string, invoiceNo: string): string {
  const rows = saved.map((s) => `| \`${s.file}\` | \`GET /api/v1${s.route}\` | ${s.what} |`)
  return `# Export examples

One file of every document and spreadsheet the app exports, made by
\`make examples\` from a single invented sale on a throwaway database
(\`gns_examples_test\`). Every company, person, number and amount is made
up; nothing comes from \`Data/\` or production.

The sale: PT Samudra Contoh Nusantara asks for five products (COIL, PKT,
TIN, PCS and MTR lines from two vendors), with a 5% discount, a shipping
charge and 12% PPN. Quotation ${quotationNo} is sent and accepted, the PO
gets its file and the client's PO number, goes to ON_PROGRESS and
DELIVERED, and invoice ${invoiceNo} is sent. Kas Lain holds one Masuk and
one Keluar entry.

| File | Route | What it is |
| --- | --- | --- |
${rows.join("\n")}

Regenerate after a template or export change with \`make examples\`
(needs \`make deps-up\` and xelatex). The dates are the day it ran.
`
}

mkdirSync(outDir, { recursive: true })
await main()
