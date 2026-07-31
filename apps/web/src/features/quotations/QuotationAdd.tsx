import { useEffect, useMemo, useState } from "react"
import Sidebar from "@/components/shared/Sidebar"
import ClientAdd from "@/features/clients/ClientAdd"
import { dedupeByCompany, fromClientHit, fromClientRow } from "@/features/clients/helpers"
import { useClientContacts, useClientSearch, useClients } from "@/features/clients/hooks"
import ProductAdd from "@/features/items/ProductAdd"
import { useCreateQuotation } from "@/features/quotations/hooks"
import { useUnits } from "@/features/units/hooks"
import { useDebouncedValue } from "@/hooks/useDebouncedValue"
import { computeTaxBreakdown, formatNumber as formatRp } from "@/lib/format"
import type { Page } from "@/lib/page"
import { ui } from "@/lib/ui"
import type { QuotationCreateInput, QuotationItemInput } from "@/types/api"
import DiscountModal from "./DiscountModal"
import type { ProductItem } from "./QuotationEdit"
import Step1Client, { type Client } from "./Step1Client"
import Step2Product from "./Step2Product"
import Step3Shipping from "./Step3Shipping"
import Step4Summary from "./Step4Summary"
import { qe, stepLabel, stepNum, stepPill } from "./wizard-styles"

interface QuotationAddProps {
  onNavigate: (page: Page) => void
  onLogout: () => void
}

// Flat brand submit (legacy used a solid #630ED4, not the primary gradient).
const flatSubmit =
  "inline-flex items-center justify-center gap-2 rounded-md bg-primary-700 px-6 py-2 text-sm font-bold text-white shadow-sm transition hover:opacity-90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-600/40"

const steps = [
  { n: 1, label: "KLIEN" },
  { n: 2, label: "PRODUK" },
  { n: 3, label: "PENGIRIMAN" },
  { n: 4, label: "RINGKASAN" },
]

export default function QuotationAdd({ onNavigate, onLogout }: QuotationAddProps) {
  const [step, setStep] = useState(1)

  // Empty client for add mode.
  const [selectedClient, setSelectedClient] = useState("")
  const [search, setSearch] = useState("")
  const [showClientAdd, setShowClientAdd] = useState(false)
  const [selectedContactId, setSelectedContactId] = useState<number | undefined>(undefined)

  // ProductAdd form state.
  const [showProductAdd, setShowProductAdd] = useState(false)
  const [editingProduct, setEditingProduct] = useState<ProductItem | null>(null)
  const [showDiscountModal, setShowDiscountModal] = useState(false)
  const [discountPct, setDiscountPct] = useState<number>(0)

  // Empty products.
  const [products, setProducts] = useState<ProductItem[]>([])
  const [prodPageSize, setProdPageSize] = useState(5)
  const [prodPage, setProdPage] = useState(1)
  const [isRowDropdownOpen, setIsRowDropdownOpen] = useState(false)

  // Empty shipping.
  const [shippingAddress, setShippingAddress] = useState("")
  const [shippingTime, setShippingTime] = useState("")
  const [shippingCost, setShippingCost] = useState("")

  // Deadline state.
  const [jatuhTempo, setJatuhTempo] = useState("")
  const [berlakuSampai, setBerlakuSampai] = useState("")

  // Step gating logic.
  const isAlamatFilled = shippingAddress.trim().length >= 20 && /[a-zA-Z]/.test(shippingAddress)
  const isWaktuFilled = isAlamatFilled && shippingTime.trim().length > 0
  const isTenggatWaktuFilled = jatuhTempo.trim().length > 0 && berlakuSampai.trim().length > 0
  const hasContent = products.length > 0 || isAlamatFilled

  useEffect(() => {
    if (!isAlamatFilled) {
      setShippingTime("")
      setShippingCost("")
    }
  }, [isAlamatFilled])

  useEffect(() => {
    if (!isWaktuFilled) setShippingCost("")
  }, [isWaktuFilled])

  let isNextDisabled = false
  if (step === 1) isNextDisabled = selectedClient === ""

  function deleteProduct(id: number) {
    setProducts((prev) => prev.filter((p) => p.id !== id))
  }

  const trimmedSearch = search.trim()
  const debouncedSearch = useDebouncedValue(trimmedSearch, 250)
  const { data: clientsData } = useClients({ limit: 50 })
  const { data: searchHits } = useClientSearch(debouncedSearch, { limit: 30 })
  const { data: unitsData } = useUnits()
  const createQuotation = useCreateQuotation()

  const numericClientId = Number(selectedClient)
  const { data: contacts = [] } = useClientContacts(
    numericClientId > 0 ? numericClientId : undefined,
  )

  const remoteClients: Array<Client & { contactId?: number }> = useMemo(() => {
    if (debouncedSearch.length > 0) {
      return dedupeByCompany(searchHits ?? []).map(fromClientHit)
    }
    return (clientsData?.rows ?? []).map(fromClientRow)
  }, [debouncedSearch, searchHits, clientsData])

  const baseClients: Client[] = remoteClients
  const sortedClients = [...baseClients].sort((a, b) => a.name.localeCompare(b.name, "id"))
  const filteredClients =
    trimmedSearch && remoteClients.length === 0
      ? sortedClients.filter(
          (c) =>
            c.name.toLowerCase().includes(trimmedSearch.toLowerCase()) ||
            c.narahubung.toLowerCase().includes(trimmedSearch.toLowerCase()),
        )
      : sortedClients.slice(0, 10)

  const currentClient = baseClients.find((c) => c.id === selectedClient)

  // Auto-select contact when client or contacts list changes.
  useEffect(() => {
    if (!selectedClient) {
      setSelectedContactId(undefined)
      return
    }
    const clientContactId = (currentClient as (Client & { contactId?: number }) | undefined)
      ?.contactId
    const ids = contacts.map((c) => c.id)
    if (clientContactId && ids.includes(clientContactId)) {
      setSelectedContactId(clientContactId)
    } else if (contacts.length > 0) {
      setSelectedContactId(contacts[0].id)
    } else {
      setSelectedContactId(clientContactId)
    }
  }, [selectedClient, contacts, currentClient])

  const unitIdByCode = useMemo(() => {
    const m = new Map<string, number>()
    for (const u of unitsData ?? []) m.set(u.code.toUpperCase(), u.id)
    return m
  }, [unitsData])

  const canSubmit =
    Number.isFinite(numericClientId) &&
    numericClientId > 0 &&
    products.length > 0 &&
    products.every((p) => unitIdByCode.has(p.satuan.toUpperCase())) &&
    isTenggatWaktuFilled &&
    hasContent

  function buildItems(): QuotationItemInput[] {
    const items: QuotationItemInput[] = products.map((p) => ({
      requestedItemId: p.requestedItemId,
      requestedImpa: p.requestedKodeImpa || p.kodeImpa || undefined,
      requestedName: p.requestedNama || p.nama,
      offeredItemId: p.itemId,
      vendorProductId: p.vendorProductId,
      qty: String(p.jumlah),
      unitId: unitIdByCode.get(p.satuan.toUpperCase()) ?? 0,
      sellingPrice: String(p.hargaJual),
      costPrice: String(p.hargaBeli),
    }))
    return items
  }

  function handleSubmit() {
    if (!canSubmit) return
    const validity = Number(berlakuSampai)
    const shippingDays = Number(shippingTime)
    const input: QuotationCreateInput = {
      companyClientId: numericClientId,
      contactId: selectedContactId,
      clientRefNo: currentClient?.referenceNumber,
      paymentTerms: jatuhTempo.trim() ? `${jatuhTempo.trim()} days` : undefined,
      validityDays: Number.isFinite(validity) && validity > 0 ? validity : undefined,
      discountPct: String(discountPct),
      shippingAddress: shippingAddress || undefined,
      shippingDays: Number.isFinite(shippingDays) && shippingDays > 0 ? shippingDays : undefined,
      shippingCost: shippingCost || undefined,
      items: buildItems(),
    }
    createQuotation.mutate(input, {
      onSuccess: () => onNavigate("quotation"),
    })
  }

  // Summary computation.
  const summaryTotalProdukQty = products.reduce((sum, p) => sum + p.jumlah, 0)
  const summaryTotalHargaBeli = products.reduce((sum, p) => sum + p.hargaBeli * p.jumlah, 0)
  const summaryTotalHargaJual = products.reduce((sum, p) => sum + p.hargaJual * p.jumlah, 0)
  const nominalDiskon = summaryTotalHargaJual * (discountPct / 100)
  const summarySubTotal = summaryTotalHargaJual - nominalDiskon
  const summaryShippingCost = Number(shippingCost) || 0
  const hasProducts = products.length > 0
  const {
    dppNilaiLain: summaryDpp,
    ppnAmount: summaryPpn,
    grandTotal: summaryGrandTotal,
  } = computeTaxBreakdown({
    subtotal: summarySubTotal,
    shipping: summaryShippingCost,
  })
  const summaryProfit = hasProducts ? summarySubTotal - summaryTotalHargaBeli : 0

  return (
    <div className="admin-shell">
      <Sidebar activePage="quotation" onNavigate={onNavigate} onLogout={onLogout} />

      <div className="admin-main">
        <div className="page-content">
          {/* Header & Stepper */}
          <div className={qe.headerSection}>
            <div className={qe.headerLeft}>
              <nav className={ui.breadcrumb}>
                <button
                  type="button"
                  className={ui.breadcrumbLink}
                  onClick={() => onNavigate("quotation")}
                >
                  Daftar Quotation
                </button>
                <span className={ui.breadcrumbSep}>&rsaquo;</span>
                <span className={ui.breadcrumbCurrent}>Tambah Quotation</span>
              </nav>
              <div className={qe.titleRow}>
                <h1 className={qe.title}>Tambah Quotation Baru</h1>
              </div>
            </div>

            <div className={qe.headerActions}>
              {step > 1 && (
                <button
                  type="button"
                  className={`${ui.btnOutline} w-[148px]`}
                  onClick={() => setStep(step - 1)}
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M19 12H5M12 5l-7 7 7 7" />
                  </svg>{" "}
                  Kembali
                </button>
              )}
              {step < steps.length && (
                <button
                  type="button"
                  className={`${ui.btnPrimary} w-[148px]`}
                  onClick={() => setStep(step + 1)}
                  disabled={isNextDisabled}
                >
                  Lanjut{" "}
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="-scale-x-100"
                  >
                    <path d="M19 12H5M12 5l-7 7 7 7" />
                  </svg>
                </button>
              )}
              {step === steps.length && (
                <button
                  type="button"
                  className={`${flatSubmit} w-[180px]`}
                  onClick={handleSubmit}
                  disabled={!canSubmit || createQuotation.isPending}
                >
                  {createQuotation.isPending ? "Menyimpan..." : "Buat Penawaran"}
                </button>
              )}
            </div>
          </div>

          <div className={qe.stepper}>
            {steps.map((s, i) => (
              <div key={s.n} className="contents">
                <div className={qe.stepSlot}>
                  <div className={stepPill(i === step - 1)}>
                    <span className={stepNum(i === step - 1)}>{s.n}</span>
                  </div>
                  <span className={stepLabel(i === step - 1)}>{s.label}</span>
                </div>
                {i < steps.length - 1 && <div key={`line-${i}`} className={qe.stepConnector} />}
              </div>
            ))}
          </div>

          {/* Render Step Components */}
          {step === 1 && (
            <Step1Client
              search={search}
              setSearch={setSearch}
              filteredClients={filteredClients}
              selectedClient={selectedClient}
              setSelectedClient={setSelectedClient}
              setShowClientAdd={setShowClientAdd}
              contacts={contacts}
              selectedContactId={selectedContactId}
              setSelectedContactId={setSelectedContactId}
            />
          )}
          {step === 2 && (
            <Step2Product
              products={products}
              deleteProduct={deleteProduct}
              setEditingProduct={setEditingProduct}
              setShowProductAdd={setShowProductAdd}
              prodPageSize={prodPageSize}
              setProdPageSize={setProdPageSize}
              prodPage={prodPage}
              setProdPage={setProdPage}
              isRowDropdownOpen={isRowDropdownOpen}
              setIsRowDropdownOpen={setIsRowDropdownOpen}
              setShowDiscountModal={setShowDiscountModal}
              discountPct={discountPct}
              formatRp={formatRp}
              summaryTotalHargaBeli={summaryTotalHargaBeli}
              summaryTotalHargaJual={summaryTotalHargaJual}
              nominalDiskon={nominalDiskon}
              summarySubTotal={summarySubTotal}
              summaryDpp={summaryDpp}
              summaryPpn={summaryPpn}
              onImportProducts={(newProds) => setProducts((prev) => [...prev, ...newProds])}
            />
          )}
          {step === 3 && (
            <Step3Shipping
              shippingAddress={shippingAddress}
              setShippingAddress={setShippingAddress}
              shippingTime={shippingTime}
              setShippingTime={setShippingTime}
              shippingCost={shippingCost}
              setShippingCost={setShippingCost}
              isAlamatFilled={isAlamatFilled}
              isWaktuFilled={isWaktuFilled}
              formatRp={formatRp}
            />
          )}
          {step === 4 && (
            <Step4Summary
              jatuhTempo={jatuhTempo}
              setJatuhTempo={setJatuhTempo}
              berlakuSampai={berlakuSampai}
              setBerlakuSampai={setBerlakuSampai}
              currentClient={currentClient}
              shippingAddress={shippingAddress}
              shippingTime={shippingTime}
              shippingCost={shippingCost}
              products={products}
              discountPct={discountPct}
              formatRp={formatRp}
              summaryTotalProdukQty={summaryTotalProdukQty}
              summaryTotalHargaBeli={summaryTotalHargaBeli}
              summaryTotalHargaJual={summaryTotalHargaJual}
              nominalDiskon={nominalDiskon}
              summarySubTotal={summarySubTotal}
              summaryDpp={summaryDpp}
              summaryPpn={summaryPpn}
              summaryShippingCost={summaryShippingCost}
              summaryProfit={summaryProfit}
              summaryGrandTotal={summaryGrandTotal}
            />
          )}
        </div>
      </div>

      {/* Modals */}
      <DiscountModal
        open={showDiscountModal}
        onOpenChange={setShowDiscountModal}
        initialDiscount={discountPct}
        onSuccess={(val) => {
          setDiscountPct(val)
          setShowDiscountModal(false)
        }}
      />
      <ClientAdd
        open={showClientAdd}
        onOpenChange={setShowClientAdd}
        onSuccess={() => {
          setShowClientAdd(false)
          setStep(2)
        }}
      />
      <ProductAdd
        open={showProductAdd}
        initialData={editingProduct}
        onOpenChange={(open) => {
          setShowProductAdd(open)
          if (!open) setEditingProduct(null)
        }}
        onSuccess={(data) => {
          const splitOffer = (s: string): { kode: string; nama: string } => {
            const trimmed = s.trim()
            if (!trimmed) return { kode: "", nama: "" }
            const [first, ...rest] = trimmed.split(/\s*-\s*/)
            if (rest.length > 0 && /^\d+$/.test(first)) {
              return { kode: first, nama: rest.join(" - ") }
            }
            return { kode: "", nama: trimmed }
          }
          const offer = splitOffer(data.kodeImpaNama)
          const nama = offer.nama
          const kodeImpa = offer.kode
          const reqSplit = splitOffer(data.requestedKodeImpaNama)
          const requestedNama = reqSplit.nama || nama
          const requestedKodeImpa = reqSplit.kode

          if (editingProduct) {
            setProducts((prev) =>
              prev.map((p) =>
                p.id === editingProduct.id
                  ? {
                      ...p,
                      itemId: data.itemId,
                      requestedItemId: data.requestedItemId,
                      vendorId: data.vendorId,
                      vendorProductId: data.vendorProductId,
                      nama,
                      kodeImpa,
                      requestedNama,
                      requestedKodeImpa,
                      vendor: data.namaVendor,
                      jumlah: Number(data.jumlahProduk) || 1,
                      satuan: data.satuan,
                      hargaBeli: Number(data.hargaBeli) || 0,
                      hargaJual: Number(data.hargaJual) || 0,
                    }
                  : p,
              ),
            )
          } else {
            const nextId = products.reduce((m, p) => Math.max(m, p.id), 0) + 1
            setProducts((prev) => [
              ...prev,
              {
                id: nextId,
                itemId: data.itemId,
                requestedItemId: data.requestedItemId,
                vendorId: data.vendorId,
                vendorProductId: data.vendorProductId,
                nama,
                kodeImpa,
                requestedNama,
                requestedKodeImpa,
                vendor: data.namaVendor,
                jumlah: Number(data.jumlahProduk) || 1,
                satuan: data.satuan,
                hargaBeli: Number(data.hargaBeli) || 0,
                hargaJual: Number(data.hargaJual) || 0,
              },
            ])
          }
          setEditingProduct(null)
        }}
      />
    </div>
  )
}
