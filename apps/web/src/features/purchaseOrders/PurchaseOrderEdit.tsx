import { Link, useNavigate } from "@tanstack/react-router"
import { useCallback, useEffect, useMemo, useState } from "react"
import StateMessage from "@/components/shared/StateMessage"
import { fromClientRow } from "@/features/clients/helpers"
import { useClient } from "@/features/clients/hooks"
import ProductAdd from "@/features/items/ProductAdd"
import DiscountModal from "@/features/quotations/DiscountModal"
import Step2Product from "@/features/quotations/Step2Product"
import Step3Shipping from "@/features/quotations/Step3Shipping"
import Step4Summary from "@/features/quotations/Step4Summary"
import { useUnits } from "@/features/units/hooks"
import { computeTaxBreakdown, formatNumber as formatRp, toNum } from "@/lib/format"
import { toast } from "@/lib/toast"
import { ui } from "@/lib/ui"
import type { PoUpdateItemsInput, PurchaseOrderItemRow, PurchaseOrderRow } from "@/types/api"
import {
  linesMissingUnit,
  lineToInput,
  loadFailureMessage,
  type PoEditLine,
  poLinesToEdit,
} from "./adapters"
import { usePoItems, usePurchaseOrderByQuotation, useUpdatePoItems } from "./hooks"
import { isPoLockRefusal, isVersionConflict } from "./PurchaseOrderDetail/helpers"

type PurchaseOrderEditProps = {
  // Resolved from the route's quotation id
  po: PurchaseOrderRow
}

// Steps without a client step.
//
// The client is fixed on a PO.
const steps = [
  { n: 1, label: "PRODUK" },
  { n: 2, label: "PENGIRIMAN" },
  { n: 3, label: "RINGKASAN" },
]

function isAddressValid(v: string): boolean {
  return v.trim().length >= 20 && /[a-zA-Z]/.test(v)
}

// Split "123456 - Name" parts.
function splitOffer(s: string): { kode: string; nama: string } {
  const trimmed = s.trim()
  if (!trimmed) return { kode: "", nama: "" }
  const [first, ...rest] = trimmed.split(/\s*-\s*/)
  if (rest.length > 0 && /^\d+$/.test(first)) return { kode: first, nama: rest.join(" - ") }
  return { kode: "", nama: trimmed }
}

const arrowIcon = (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M19 12H5M12 5l-7 7 7 7" />
  </svg>
)

export default function PurchaseOrderEdit({ po }: PurchaseOrderEditProps) {
  const navigate = useNavigate()
  const [step, setStep] = useState(1)

  const { refetch: refetchPo } = usePurchaseOrderByQuotation(po.quotationId)
  const {
    data: poItems,
    refetch: refetchItems,
    isError: itemsError,
    isFetching: itemsFetching,
  } = usePoItems(po.id)
  const {
    data: unitsData,
    refetch: refetchUnits,
    isError: unitsError,
    isFetching: unitsFetching,
  } = useUnits()
  const { data: clientRow } = useClient(po.companyClientId)
  const updateMutation = useUpdatePoItems()

  const [hydrated, setHydrated] = useState(false)
  const [showProductAdd, setShowProductAdd] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [showDiscountModal, setShowDiscountModal] = useState(false)
  const [discountPct, setDiscountPct] = useState(0)
  const [products, setProducts] = useState<PoEditLine[]>([])
  const [prodPageSize, setProdPageSize] = useState(5)
  const [prodPage, setProdPage] = useState(1)
  const [isRowDropdownOpen, setIsRowDropdownOpen] = useState(false)

  const [shippingAddress, setShippingAddress] = useState("")
  const [shippingTime, setShippingTime] = useState("")
  const [shippingCost, setShippingCost] = useState("")

  // Shown by the summary step, never saved on a PO.
  const [jatuhTempo, setJatuhTempo] = useState("")
  const [berlakuSampai, setBerlakuSampai] = useState("")

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

  // Form state from stored PO.
  const hydrate = useCallback(
    (source: PurchaseOrderRow, items: PurchaseOrderItemRow[]) => {
      setProducts(
        poLinesToEdit(items, (id) => (id !== undefined ? (unitNameById.get(id) ?? "") : "")),
      )
      setDiscountPct(toNum(source.discountPct))
      const ship = items.find((it) => it.itemType === "shipping")
      setShippingAddress(ship?.shipDestination ?? "")
      setShippingTime(ship?.shippingDays ? String(ship.shippingDays) : "")
      setShippingCost(ship ? String(toNum(ship.sellingPrice)) : "")
      setHydrated(true)
    },
    [unitNameById],
  )

  // A failed load says so.
  //
  // The form waits for lines and units, so without this a 4xx on either
  // left it empty with Lanjut disabled and no reason given.
  const unitsFailed = unitsError && !unitsData
  const itemsFailed = itemsError && !poItems
  const loadFailed = !hydrated && (unitsFailed || itemsFailed)

  function retryLoad() {
    if (unitsFailed) void refetchUnits()
    if (itemsFailed) void refetchItems()
  }

  // Once, when the PO, lines and units are all in.
  useEffect(() => {
    if (hydrated || !poItems || !unitsData) return
    hydrate(po, poItems)
  }, [hydrated, po, poItems, unitsData, hydrate])

  // Clearing follows user edits only.
  //
  // A stored short address must not wipe the stored days and cost on load,
  // so the dependent fields are cleared here rather than in an effect.
  function changeAddress(v: string) {
    setShippingAddress(v)
    if (!isAddressValid(v)) {
      setShippingTime("")
      setShippingCost("")
    }
  }

  function changeTime(v: string) {
    setShippingTime(v)
    if (v.trim() === "") setShippingCost("")
  }

  const isAlamatFilled = isAddressValid(shippingAddress)
  const isWaktuFilled = isAlamatFilled && shippingTime.trim().length > 0
  const hasContent = products.length > 0 || isAlamatFilled

  const currentClient = clientRow ? fromClientRow(clientRow) : undefined
  const editingProduct = products.find((p) => p.id === editingId) ?? null

  const summaryTotalProdukQty = products.reduce((sum, p) => sum + p.jumlah, 0)
  const summaryTotalHargaBeli = products.reduce((sum, p) => sum + p.hargaBeli * p.jumlah, 0)
  const summaryTotalHargaJual = products.reduce((sum, p) => sum + p.hargaJual * p.jumlah, 0)
  const nominalDiskon = summaryTotalHargaJual * (discountPct / 100)
  const summarySubTotal = summaryTotalHargaJual - nominalDiskon
  const summaryShippingCost = Number(shippingCost) || 0
  const hasProducts = products.length > 0
  // Preview only; the saved PO totals come from the server.
  const {
    dppNilaiLain: summaryDpp,
    ppnAmount: summaryPpn,
    grandTotal: summaryGrandTotal,
  } = computeTaxBreakdown({
    subtotal: summarySubTotal,
    shipping: summaryShippingCost,
  })
  const summaryProfit = hasProducts ? summarySubTotal - summaryTotalHargaBeli : 0

  async function handleSave() {
    const missing = linesMissingUnit(products, unitIdByCode)
    if (missing.length > 0) {
      toast.error(`Satuan belum dikenali untuk: ${missing.join(", ")}.`)
      return
    }
    // The server keeps the shipping line only with an address.
    const hasShipping = shippingTime.trim() !== "" || toNum(shippingCost) > 0
    if (hasShipping && !isAlamatFilled) {
      toast.error("Isi alamat pengiriman (min. 20 karakter) sebelum menyimpan pengiriman.")
      return
    }
    const shipDays = Number(shippingTime)
    const input: PoUpdateItemsInput = {
      discountPct: String(discountPct),
      // The server overwrites notes, so the stored ones go back
      notes: po.notes,
      shippingAddress: shippingAddress.trim() || undefined,
      shippingDays: Number.isFinite(shipDays) && shipDays > 0 ? shipDays : undefined,
      shippingCost: shippingCost || undefined,
      items: products.map((p) => lineToInput(p, unitIdByCode)),
    }
    try {
      await updateMutation.mutateAsync({ id: po.id, input, rowVersion: po.rowVersion })
      void navigate({ to: "/purchase-orders/$id", params: { id: String(po.quotationId) } })
    } catch (err) {
      // Locked meanwhile: nothing left to edit.
      if (isPoLockRefusal(err)) {
        void navigate({ to: "/purchase-orders/$id", params: { id: String(po.quotationId) } })
        return
      }
      // Someone saved first: reload their version.
      if (!isVersionConflict(err)) return
      const [fresh, items] = await Promise.all([refetchPo(), refetchItems()])
      if (fresh.data && items.data) {
        hydrate(fresh.data, items.data)
        setStep(1)
      }
    }
  }

  return (
    <>
      <div className={ui.pageContent}>
        <div className="flex w-full items-center justify-between gap-4 max-sm:flex-col max-sm:items-stretch">
          <div className="flex min-w-0 flex-col gap-3">
            <nav className={ui.breadcrumb} aria-label="Breadcrumb">
              <Link to="/purchase-orders" className={`${ui.breadcrumbLink} no-underline`}>
                Daftar Purchase Order
              </Link>
              <span className={ui.breadcrumbSep} aria-hidden="true">
                &rsaquo;
              </span>
              <span className={ui.breadcrumbCurrent} aria-current="page">
                Edit Purchase Order
              </span>
            </nav>
            <h1 className="text-2xl font-bold leading-8 tracking-tight text-dark-900 [overflow-wrap:anywhere]">
              Edit Purchase Order
            </h1>
          </div>

          <div className="flex items-center gap-4 max-sm:*:flex-1">
            {step > 1 && (
              <button
                type="button"
                className={`${ui.btnOutline} w-[148px] max-sm:w-auto`}
                onClick={() => setStep(step - 1)}
              >
                {arrowIcon} Kembali
              </button>
            )}
            {step < steps.length && (
              <button
                type="button"
                className={`${ui.btnPrimary} w-[148px] max-sm:w-auto`}
                onClick={() => setStep(step + 1)}
                disabled={!hydrated}
              >
                Lanjut <span className="inline-flex -scale-x-100">{arrowIcon}</span>
              </button>
            )}
            {step === steps.length && (
              <button
                type="button"
                className={`${ui.btnPrimary} w-[148px] max-sm:w-auto`}
                disabled={!hydrated || !hasContent || updateMutation.isPending}
                onClick={() => void handleSave()}
              >
                {updateMutation.isPending ? "Menyimpan..." : "Simpan"}
              </button>
            )}
          </div>
        </div>

        {loadFailed ? (
          <StateMessage
            title="Form edit belum dapat dibuka"
            action={
              <button
                type="button"
                className={ui.btnPrimary}
                disabled={unitsFetching || itemsFetching}
                onClick={retryLoad}
              >
                {unitsFetching || itemsFetching ? "Memuat..." : "Coba Lagi"}
              </button>
            }
          >
            <p className="m-0">{loadFailureMessage(unitsFailed, itemsFailed)}</p>
          </StateMessage>
        ) : (
          <>
            <ol className="m-0 flex w-full list-none items-start p-0">
              {steps.map((s, i) => {
                const isActive = i === step - 1
                return (
                  <li key={s.n} className="contents">
                    <div
                      className="flex flex-col items-center gap-2"
                      aria-current={isActive ? "step" : undefined}
                    >
                      <div
                        className={`flex h-10 w-[162px] items-center justify-center rounded-lg transition-all duration-300 ease-[ease] motion-reduce:transition-none max-sm:w-12 ${
                          isActive
                            ? "bg-primary-700 opacity-100 shadow-[0px_10px_15px_-3px_rgba(109,40,217,0.2),0px_4px_6px_-4px_rgba(109,40,217,0.2)]"
                            : "bg-dark-200 opacity-50"
                        }`}
                      >
                        <span
                          className={`text-sm font-bold ${isActive ? "text-white" : "text-dark-600"}`}
                        >
                          {s.n}
                        </span>
                      </div>
                      <span
                        className={`text-caption uppercase tracking-[1px] ${
                          isActive ? "font-bold text-primary-700" : "font-normal text-dark-600"
                        }`}
                      >
                        {s.label}
                      </span>
                    </div>
                    {i < steps.length - 1 && (
                      <div
                        aria-hidden="true"
                        className="mt-5 h-0.5 min-w-2 flex-1 bg-[rgba(203,213,225,0.3)]"
                      />
                    )}
                  </li>
                )
              })}
            </ol>

            {step === 1 && (
              <Step2Product
                products={products}
                deleteProduct={(id) => setProducts((prev) => prev.filter((p) => p.id !== id))}
                setEditingProduct={(p) => setEditingId(p?.id ?? null)}
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
            {step === 2 && (
              <Step3Shipping
                shippingAddress={shippingAddress}
                setShippingAddress={changeAddress}
                shippingTime={shippingTime}
                setShippingTime={changeTime}
                shippingCost={shippingCost}
                setShippingCost={setShippingCost}
                isAlamatOk={isAlamatFilled}
                addressRequired
                isWaktuFilled={isWaktuFilled}
                formatRp={formatRp}
              />
            )}
            {step === 3 && (
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
          </>
        )}
      </div>

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
          if (!open) setEditingId(null)
        }}
        onSuccess={(data) => {
          const offer = splitOffer(data.kodeImpaNama)
          const req = splitOffer(data.requestedKodeImpaNama)
          const fields = {
            itemId: data.itemId,
            vendorId: data.vendorId,
            vendorProductId: data.vendorProductId,
            nama: offer.nama,
            kodeImpa: offer.kode,
            requestedNama: req.nama || offer.nama,
            requestedKodeImpa: req.kode,
            vendor: data.namaVendor,
            jumlah: Number(data.jumlahProduk) || 1,
            satuan: data.satuan,
            hargaBeli: Number(data.hargaBeli) || 0,
            hargaJual: Number(data.hargaJual) || 0,
          }
          if (editingProduct) {
            // Stored fields ride along on the touched line.
            setProducts((prev) =>
              prev.map((p) =>
                p.id === editingProduct.id ? { ...p, ...fields, touched: true } : p,
              ),
            )
          } else {
            setProducts((prev) => [
              ...prev,
              { id: prev.reduce((m, p) => Math.max(m, p.id), 0) + 1, ...fields },
            ])
          }
          setEditingId(null)
        }}
      />
    </>
  )
}
