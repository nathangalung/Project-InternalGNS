import { Link, useNavigate } from "@tanstack/react-router"
import { useEffect, useMemo, useRef, useState } from "react"
import LoadingState from "@/components/shared/LoadingState"
import NotFoundState from "@/components/shared/NotFoundState"
import StateMessage from "@/components/shared/StateMessage"
import { clientCardInfo } from "@/features/clients/clientCard"
import { getCompanyInitials } from "@/features/clients/helpers"
import { useClient, useClientContacts } from "@/features/clients/hooks"
import ProductAdd from "@/features/items/ProductAdd"
import {
  useQuotation,
  useUpdateQuotation,
  useUpdateQuotationContact,
} from "@/features/quotations/hooks"
import { useUnits } from "@/features/units/hooks"
import { computeTaxBreakdown, formatNumber as formatRp } from "@/lib/format"
import { ui } from "@/lib/ui"
import type { QuotationItemInput, QuotationUpdateInput } from "@/types/api"
import { toItemInput, toWizardProduct } from "./adapters"
import DiscountModal from "./DiscountModal"
import { countInvalidQty, parseQty, qtyErrorIndexes, qtyErrorsById } from "./lines"
import Step1Client, { type Client } from "./Step1Client"
import Step2Product from "./Step2Product"
import Step3Shipping from "./Step3Shipping"
import Step4Summary from "./Step4Summary"
import { isEditable, quotationStatusLabel } from "./status"
import { qe, stepLabel, stepNum, stepPill } from "./wizard-styles"

type QuotationEditProps = {
  quotationId: string
}

const steps = [
  { n: 1, label: "KLIEN" },
  { n: 2, label: "PRODUK" },
  { n: 3, label: "PENGIRIMAN" },
  { n: 4, label: "RINGKASAN" },
]

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
}

export default function QuotationEdit({ quotationId }: QuotationEditProps) {
  const navigate = useNavigate()
  const [step, setStep] = useState(1)

  const [selectedClient, setSelectedClient] = useState("")
  const [selectedContactId, setSelectedContactId] = useState<number | undefined>(undefined)

  const [showProductAdd, setShowProductAdd] = useState(false)
  const [editingProduct, setEditingProduct] = useState<ProductItem | null>(null)
  const [showDiscountModal, setShowDiscountModal] = useState(false)
  const [discountPct, setDiscountPct] = useState<number>(0)
  const [products, setProducts] = useState<ProductItem[]>([])
  const [prodPageSize, setProdPageSize] = useState(5)
  const [prodPage, setProdPage] = useState(1)
  const [isRowDropdownOpen, setIsRowDropdownOpen] = useState(false)

  const [shippingAddress, setShippingAddress] = useState("")
  const [shippingTime, setShippingTime] = useState("")
  const [shippingCost, setShippingCost] = useState("")

  // Step 4 summary state.
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

  const numericQuotationId = Number(quotationId)
  const hasNumericQuotationId = Number.isInteger(numericQuotationId) && numericQuotationId > 0
  const { data: detail, isPending: isDetailPending } = useQuotation(
    hasNumericQuotationId ? numericQuotationId : undefined,
  )
  const [qtyFail, setQtyFail] = useState<{
    lines: ProductItem[]
    byId: Record<number, string>
  } | null>(null)
  const updateMutation = useUpdateQuotation()
  const updateContactMutation = useUpdateQuotationContact()
  // Fetch contacts by quotation's own company, not selected client.
  const { data: contacts = [] } = useClientContacts(detail?.companyClientId)
  const { data: clientRow } = useClient(detail?.companyClientId)

  const { data: unitsData } = useUnits()

  // The client is fixed on edit.
  //
  // PUT /quotations/{id} has no client field, so a different pick would be
  // dropped silently. Step 1 shows the quotation's own client only; the
  // summary reads its live data and the contact picked in step 1.
  const lockedClient: Client | undefined = useMemo(() => {
    if (!detail) return undefined
    const contactId = selectedContactId ?? detail.contactId
    const info = clientCardInfo(
      {
        narahubung: contactId === detail.contactId ? detail.contactName : undefined,
        referenceNumber: detail.clientRefNo,
      },
      clientRow,
      contacts,
      contactId,
    )
    return {
      id: String(detail.companyClientId),
      name: detail.companyClientName,
      narahubung: info.narahubung ?? "",
      country: clientRow?.countryCode ?? "",
      initials: getCompanyInitials(detail.companyClientName),
      phone: info.phone,
      email: info.email,
      nomorTKU: info.nomorTKU,
      referenceNumber: info.referenceNumber,
      npwp: info.npwp,
      lokasi: info.lokasi,
    }
  }, [detail, clientRow, contacts, selectedContactId])
  const clientOptions = lockedClient ? [lockedClient] : []
  const currentClient = lockedClient?.id === selectedClient ? lockedClient : undefined

  const unitNameById = useMemo(() => {
    const m = new Map<number, string>()
    for (const u of unitsData ?? []) m.set(u.id, u.code)
    return m
  }, [unitsData])

  const unitIdByCode = useMemo(() => {
    const m = new Map<string, number>()
    for (const u of unitsData ?? []) m.set(u.code.toUpperCase(), u.id)
    return m
  }, [unitsData])

  // Blocks save on units and qty.
  const invalidQty = countInvalidQty(products)
  const canSave =
    products.length > 0 &&
    invalidQty === 0 &&
    products.every((p) => unitIdByCode.has(p.satuan.toUpperCase()))

  // Server errors apply to the lines they were raised for.
  const qtyErrors = qtyFail?.lines === products ? qtyFail.byId : {}

  // Wizard state is seeded once, after both the quotation and the units it
  // needs to resolve unit codes have arrived. Any later refetch of the same
  // quotation leaves entered steps alone; the route keys this component by id,
  // so a different quotation remounts and seeds again.
  const hydrated = useRef(false)
  useEffect(() => {
    if (hydrated.current || !detail || !unitsData) return
    hydrated.current = true
    setSelectedClient(String(detail.companyClientId))
    if (detail.contactId) setSelectedContactId(detail.contactId)
    setDiscountPct(Number(detail.discountPct) || 0)
    const productItems: ProductItem[] = detail.items
      .filter((it) => it.itemType === "product")
      .map((it, i) =>
        toWizardProduct(
          it,
          i + 1,
          it.unitId !== undefined ? (unitNameById.get(it.unitId) ?? "") : "",
        ),
      )
    setProducts(productItems)
    const ship = detail.items.find((it) => it.itemType === "shipping")
    if (ship) {
      setShippingAddress(ship.shipDestination ?? "")
      if (ship.shippingDays) setShippingTime(String(ship.shippingDays))
      const cost = Number(ship.sellingPrice)
      setShippingCost(Number.isFinite(cost) ? String(cost) : "")
    }
    if (detail.validityDays) setBerlakuSampai(String(detail.validityDays))
    const termDays = Number.parseInt(detail.paymentTerms ?? "", 10)
    if (Number.isFinite(termDays) && termDays > 0) setJatuhTempo(String(termDays))
  }, [detail, unitsData, unitNameById])

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

  function goToDetail() {
    void navigate({ to: "/quotations/$id", params: { id: quotationId } })
  }

  function handleSave() {
    if (!hasNumericQuotationId || !detail || !canSave) return
    const items: QuotationItemInput[] = products.map((p) =>
      toItemInput(p, unitIdByCode.get(p.satuan.toUpperCase()) ?? 0),
    )
    const shipDays = Number(shippingTime)
    // PUT replaces the row, so fields the wizard does not edit are sent back.
    const input: QuotationUpdateInput = {
      clientRefNo: detail.clientRefNo ?? undefined,
      vesselName: detail.vesselName ?? undefined,
      notes: detail.notes ?? undefined,
      paymentTerms: jatuhTempo.trim() ? `${jatuhTempo.trim()} days` : undefined,
      validityDays: Number(berlakuSampai) > 0 ? Number(berlakuSampai) : undefined,
      discountPct: String(discountPct),
      shippingAddress: shippingAddress || undefined,
      shippingDays: Number.isFinite(shipDays) && shipDays > 0 ? shipDays : undefined,
      shippingCost: shippingCost || undefined,
      items,
    }
    updateMutation.mutate(
      { id: numericQuotationId, input, rowVersion: detail.rowVersion },
      {
        onSuccess: () => {
          // Chain contact update when selection changed.
          if (selectedContactId !== undefined && selectedContactId !== detail.contactId) {
            updateContactMutation.mutate(
              { id: numericQuotationId, contactId: selectedContactId },
              { onSuccess: goToDetail },
            )
          } else {
            goToDetail()
          }
        },
        onError: (err) =>
          setQtyFail({ lines: products, byId: qtyErrorsById(products, qtyErrorIndexes(err)) }),
      },
    )
  }

  if (!hasNumericQuotationId || (!detail && !isDetailPending)) {
    return (
      <NotFoundState
        title="Quotation tidak ditemukan"
        backTo={{ to: "/quotations", label: "Kembali ke Daftar Quotation" }}
      />
    )
  }
  if (!detail) return <LoadingState label="Memuat quotation…" />
  if (!isEditable(detail.status)) {
    return (
      <StateMessage
        title="Quotation tidak dapat diubah"
        action={
          <Link
            to="/quotations/$id"
            params={{ id: quotationId }}
            className={`${ui.btnPrimary} no-underline`}
          >
            Kembali ke Detail Quotation
          </Link>
        }
      >
        Hanya quotation berstatus Draf yang dapat diubah. Status saat ini{" "}
        {quotationStatusLabel(detail.status)}.
        {detail.canRevise && " Gunakan Buat Revisi di halaman detail untuk membuat draf baru."}
      </StateMessage>
    )
  }

  return (
    <>
      <div className={ui.pageContent}>
        {/* Header & Stepper */}
        <div className={qe.headerSection}>
          <div className={qe.headerLeft}>
            <nav className={ui.breadcrumb}>
              <button
                type="button"
                className={ui.breadcrumbLink}
                onClick={() => void navigate({ to: "/quotations" })}
              >
                Daftar Quotation
              </button>
              <span className={ui.breadcrumbSep}>&rsaquo;</span>
              <span className={ui.breadcrumbCurrent}>Edit Quotation</span>
            </nav>
            <div className={qe.titleRow}>
              <h1 className={qe.title}>Edit Quotation</h1>
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
                  aria-hidden="true"
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
                  aria-hidden="true"
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
                className={`${qe.submit} w-[148px]`}
                disabled={
                  !isTenggatWaktuFilled ||
                  !hasContent ||
                  !canSave ||
                  updateMutation.isPending ||
                  updateContactMutation.isPending
                }
                onClick={handleSave}
              >
                {updateMutation.isPending || updateContactMutation.isPending
                  ? "Menyimpan..."
                  : "Simpan"}
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
            search=""
            setSearch={() => undefined}
            filteredClients={clientOptions}
            selectedClient={selectedClient}
            setSelectedClient={setSelectedClient}
            setShowClientAdd={() => undefined}
            contacts={contacts}
            selectedContactId={selectedContactId}
            setSelectedContactId={setSelectedContactId}
            lockClient
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
            quotationId={numericQuotationId}
            qtyErrors={qtyErrors}
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
            invalidQtyCount={invalidQty}
          />
        )}
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
                      jumlah: parseQty(data.jumlahProduk),
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
                jumlah: parseQty(data.jumlahProduk),
                satuan: data.satuan,
                hargaBeli: Number(data.hargaBeli) || 0,
                hargaJual: Number(data.hargaJual) || 0,
              },
            ])
          }
          setEditingProduct(null)
        }}
      />
    </>
  )
}
