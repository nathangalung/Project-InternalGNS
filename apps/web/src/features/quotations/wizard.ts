import type { ProductAddFormData } from "@/features/items/ProductAdd/helpers"
import { computeTaxBreakdown, lineNet, sumRupiah } from "@/lib/format"
import { isValidAddress, optionalAddressError } from "@/lib/validation"
import type { QuotationDetail } from "@/types/api"
import { toWizardProduct } from "./adapters"
import { parseQty } from "./lines"

// One wizard product line.
export type ProductItem = {
  id: number
  itemId?: number
  requestedItemId?: number
  vendorId?: number
  vendorProductId?: number
  nama: string
  kodeImpa: string
  requestedNama: string
  requestedKodeImpa: string
  vendor: string
  jumlah: number
  satuan: string
  hargaBeli: number
  hargaJual: number
  // Requested but not offered (Tidak Ditawarkan)
  noOffer?: boolean
}

export const WIZARD_STEPS = [
  { n: 1, label: "KLIEN" },
  { n: 2, label: "PRODUK" },
  { n: 3, label: "PENGIRIMAN" },
  { n: 4, label: "RINGKASAN" },
]

export type WizardGates = {
  isAlamatOk: boolean
  isWaktuFilled: boolean
  isTenggatWaktuFilled: boolean
  hasContent: boolean
}

// Step gating for both wizards.
//
// The shipping address is optional on a quotation and required at the PO,
// so only a started one must be valid. Days need a valid address.
export function wizardGates(input: {
  shippingAddress: string
  shippingTime: string
  jatuhTempo: string
  berlakuSampai: string
  productCount: number
}): WizardGates {
  const isAlamatOk = optionalAddressError(input.shippingAddress) === null
  return {
    isAlamatOk,
    isWaktuFilled: isAlamatOk && input.shippingTime.trim().length > 0,
    isTenggatWaktuFilled:
      input.jatuhTempo.trim().length > 0 && input.berlakuSampai.trim().length > 0,
    hasContent: input.productCount > 0 || isValidAddress(input.shippingAddress),
  }
}

export type WizardSummary = {
  totalProdukQty: number
  totalHargaBeli: number
  totalHargaJual: number
  nominalDiskon: number
  subTotal: number
  shippingCost: number
  dpp: number
  ppn: number
  grandTotal: number
  profit: number
}

// Preview totals, never stored.
//
// The saved figures come from the server; this mirrors them while editing.
export function wizardSummary(
  products: ProductItem[],
  discountPct: number,
  shippingCost: string,
): WizardSummary {
  // A Tidak Ditawarkan line is not sold, so it adds nothing.
  const offered = products.filter((p) => !p.noOffer)
  const totalHargaBeli = offered.reduce((sum, p) => sum + p.hargaBeli * p.jumlah, 0)
  const totalHargaJual = offered.reduce((sum, p) => sum + p.hargaJual * p.jumlah, 0)
  // Discounted and taxed per line, as the server stores the totals.
  const nets = offered.map((p) => lineNet(p.jumlah, p.hargaJual, discountPct))
  const subTotal = sumRupiah(nets)
  const nominalDiskon = sumRupiah(offered.map((p, i) => lineNet(p.jumlah, p.hargaJual) - nets[i]))
  const shipping = Number(shippingCost) || 0
  const tax = computeTaxBreakdown([...nets, shipping])
  return {
    totalProdukQty: offered.reduce((sum, p) => sum + p.jumlah, 0),
    totalHargaBeli,
    totalHargaJual,
    nominalDiskon,
    subTotal,
    shippingCost: shipping,
    dpp: tax.dppNilaiLain,
    ppn: tax.ppnAmount,
    grandTotal: tax.grandTotal,
    profit: offered.length > 0 ? subTotal - totalHargaBeli : 0,
  }
}

// "IMPA - name" into parts.
//
// A leading all-digit segment is the IMPA code; anything else is a name.
export function splitOffer(s: string): { kode: string; nama: string } {
  const trimmed = s.trim()
  if (!trimmed) return { kode: "", nama: "" }
  const [first, ...rest] = trimmed.split(/\s*-\s*/)
  if (rest.length > 0 && /^\d+$/.test(first)) {
    return { kode: first, nama: rest.join(" - ") }
  }
  return { kode: "", nama: trimmed }
}

// Product form into the lines.
//
// Replaces the edited line in place, or appends one after the highest id.
export function upsertProduct(
  products: ProductItem[],
  editing: ProductItem | null,
  data: ProductAddFormData,
): ProductItem[] {
  const offer = splitOffer(data.kodeImpaNama)
  const requested = splitOffer(data.requestedKodeImpaNama)
  const fields = {
    itemId: data.itemId,
    requestedItemId: data.requestedItemId,
    vendorId: data.vendorId,
    vendorProductId: data.vendorProductId,
    nama: offer.nama,
    kodeImpa: offer.kode,
    requestedNama: requested.nama || offer.nama,
    requestedKodeImpa: requested.kode,
    vendor: data.namaVendor,
    jumlah: parseQty(data.jumlahProduk),
    satuan: data.satuan,
    hargaBeli: Number(data.hargaBeli) || 0,
    hargaJual: Number(data.hargaJual) || 0,
  }
  if (editing) {
    return products.map((p) => (p.id === editing.id ? { ...p, ...fields } : p))
  }
  const nextId = products.reduce((m, p) => Math.max(m, p.id), 0) + 1
  return [...products, { id: nextId, ...fields }]
}

// Unit ids by upper-case code.
export function unitIdIndex(
  units: { id: number; code: string }[] | undefined,
): Map<string, number> {
  const m = new Map<string, number>()
  for (const u of units ?? []) m.set(u.code.toUpperCase(), u.id)
  return m
}

// Why a line's unit fails.
// Null when the unit is a known code. An RFQ often carries units the
// catalog does not use (PC, EA, ROLL), and such a line cannot be saved
// until a known unit is picked for it.
export function unitIssue(satuan: string, unitIdByCode: Map<string, number>): string | null {
  // Same lookup as the submit, so a passing line always sends a unit id.
  if (unitIdByCode.has(satuan.toUpperCase())) return null
  const code = satuan.trim()
  return code ? `Satuan "${code}" tidak dikenal.` : "Satuan belum diisi."
}

// Lines with an unknown unit.
export function countUnknownUnits(
  products: ProductItem[],
  unitIdByCode: Map<string, number>,
): number {
  return products.filter((p) => unitIssue(p.satuan, unitIdByCode) !== null).length
}

// Values the wizard edits.
export type WizardSeed = {
  selectedClient: string
  selectedContactId: number | undefined
  discountPct: number
  products: ProductItem[]
  shippingAddress: string
  shippingTime: string
  shippingCost: string
  berlakuSampai: string
  jatuhTempo: string
}

// Stored quotation into steps.
//
// unitNameById resolves each line's unit code from its id.
export function seedFromDetail(d: QuotationDetail, unitNameById: Map<number, string>): WizardSeed {
  const ship = d.items.find((it) => it.itemType === "shipping")
  const cost = Number(ship?.sellingPrice)
  const termDays = Number.parseInt(d.paymentTerms ?? "", 10)
  return {
    selectedClient: String(d.companyClientId),
    selectedContactId: d.contactId || undefined,
    discountPct: Number(d.discountPct) || 0,
    products: d.items
      .filter((it) => it.itemType === "product")
      .map((it, i) =>
        toWizardProduct(
          it,
          i + 1,
          it.unitId !== undefined ? (unitNameById.get(it.unitId) ?? "") : "",
        ),
      ),
    shippingAddress: ship?.shipDestination ?? "",
    shippingTime: ship?.shippingDays ? String(ship.shippingDays) : "",
    shippingCost: Number.isFinite(cost) ? String(cost) : "",
    berlakuSampai: d.validityDays ? String(d.validityDays) : "",
    jatuhTempo: Number.isFinite(termDays) && termDays > 0 ? String(termDays) : "",
  }
}
