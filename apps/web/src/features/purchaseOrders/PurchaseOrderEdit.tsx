import { useEffect, useMemo, useState } from "react"
import Sidebar from "@/components/shared/Sidebar"
import ClientAdd from "@/features/clients/ClientAdd"
import { dedupeByCompany, fromClientHit, fromClientRow } from "@/features/clients/helpers"
import { useClientSearch, useClients } from "@/features/clients/hooks"
import ProductAdd from "@/features/items/ProductAdd"
import { usePoItems, usePurchaseOrder, useUpdatePoItems } from "@/features/purchaseOrders/hooks"
import DiscountModal from "@/features/quotations/DiscountModal"
import Step1Client, { type Client } from "@/features/quotations/Step1Client"
import Step2Product from "@/features/quotations/Step2Product"
import Step3Shipping from "@/features/quotations/Step3Shipping"
import Step4Summary from "@/features/quotations/Step4Summary"
import { useUnits } from "@/features/units/hooks"
import { useDebouncedValue } from "@/hooks/useDebouncedValue"
import { computeTaxBreakdown, formatNumber as formatRp } from "@/lib/format"
import type { Page } from "@/lib/page"
import { disabledStyle } from "@/lib/styles"
import { ui } from "@/lib/ui"
import type { PoItemInput, PoUpdateItemsInput } from "@/types/api"

interface PurchaseOrderEditProps {
  poId: string
  onNavigate: (page: Page) => void
  onLogout: () => void
}

const steps = [
  { n: 1, label: "KLIEN" },
  { n: 2, label: "PRODUK" },
  { n: 3, label: "PENGIRIMAN" },
  { n: 4, label: "RINGKASAN" },
]

export interface ProductItem {
  id: number
  quotationItemId?: number
  itemId?: number
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

export default function PurchaseOrderEdit({ poId, onNavigate, onLogout }: PurchaseOrderEditProps) {
  const [step, setStep] = useState(1)

  const [selectedClient, setSelectedClient] = useState("")
  const [search, setSearch] = useState("")
  const [showClientAdd, setShowClientAdd] = useState(false)

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

  const [jatuhTempo, setJatuhTempo] = useState("")
  const [berlakuSampai, setBerlakuSampai] = useState("")

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

  const numericPoId = Number(poId)
  const hasNumericPoId = Number.isFinite(numericPoId) && numericPoId > 0
  const { data: poDetail } = usePurchaseOrder(hasNumericPoId ? numericPoId : undefined)
  const { data: poItems } = usePoItems(hasNumericPoId ? numericPoId : undefined)
  const updateMutation = useUpdatePoItems()

  const trimmedSearch = search.trim()
  const debouncedSearch = useDebouncedValue(trimmedSearch, 250)
  const { data: clientsData } = useClients({ limit: 50 })
  const { data: searchHits } = useClientSearch(debouncedSearch, { limit: 30 })
  const { data: unitsData } = useUnits()

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

  useEffect(() => {
    if (!poDetail) return
    setSelectedClient(String(poDetail.companyClientId))
  }, [poDetail])

  useEffect(() => {
    if (!poItems) return
    const productItems: ProductItem[] = poItems
      .filter((it) => it.itemType === "product")
      .map((it, i) => {
        const sell = Number(it.sellingPrice)
        const cost = it.costPrice !== undefined ? Number(it.costPrice) : 0
        return {
          id: it.id ?? i + 1,
          quotationItemId: it.quotationItemId,
          itemId: it.offeredItemId,
          nama: it.itemName,
          kodeImpa: it.itemCode ?? "",
          requestedNama: it.itemName,
          requestedKodeImpa: it.itemCode ?? "",
          vendor: "",
          jumlah: Number(it.qty) || 0,
          satuan: it.unitId !== undefined ? (unitNameById.get(it.unitId) ?? "") : "",
          hargaBeli: Number.isFinite(cost) ? cost : 0,
          hargaJual: Number.isFinite(sell) ? sell : 0,
        }
      })
    setProducts(productItems)
    const ship = poItems.find((it) => it.itemType === "shipping")
    if (ship) {
      setShippingAddress(ship.shipDestination ?? "")
      const cost = Number(ship.sellingPrice)
      setShippingCost(Number.isFinite(cost) ? String(cost) : "")
    }
  }, [poItems, unitNameById])

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
      <Sidebar activePage="purchase-orders" onNavigate={onNavigate} onLogout={onLogout} />

      <div className="admin-main">
        <div className="page-content">
          <div className="flex w-full items-center justify-between">
            <div className="flex flex-col gap-3">
              <nav className={ui.breadcrumb}>
                <button className={ui.breadcrumbLink} onClick={() => onNavigate("purchase-orders")}>
                  Daftar Purchase Order
                </button>
                <span className={ui.breadcrumbSep}>&rsaquo;</span>
                <span className={ui.breadcrumbCurrent}>Edit Purchase Order</span>
              </nav>
              <div className="flex items-center gap-5">
                <h1 className="text-2xl font-bold leading-8 tracking-tight text-dark-900">
                  Edit Purchase Order
                </h1>
              </div>
            </div>

            <div className="flex items-center gap-4">
              {step > 1 && (
                <button className={`${ui.btnOutline} w-[148px]`} onClick={() => setStep(step - 1)}>
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
                    style={{ transform: "scaleX(-1)" }}
                  >
                    <path d="M19 12H5M12 5l-7 7 7 7" />
                  </svg>
                </button>
              )}
              {step === steps.length && (
                <button
                  className={`${ui.btnPrimary} w-[148px]`}
                  disabled={!isTenggatWaktuFilled || !hasContent || updateMutation.isPending}
                  onClick={() => {
                    if (!hasNumericPoId || !poDetail) return
                    const items: PoItemInput[] = products.map((p) => ({
                      quotationItemId: p.quotationItemId,
                      offeredItemId: p.itemId,
                      itemName: p.requestedNama || p.nama,
                      itemCode: p.requestedKodeImpa || p.kodeImpa || undefined,
                      qty: String(p.jumlah),
                      unitId: unitIdByCode.get(p.satuan.toUpperCase()),
                      sellingPrice: String(p.hargaJual),
                      costPrice: String(p.hargaBeli),
                    }))
                    const shipDays = Number(shippingTime)
                    const input: PoUpdateItemsInput = {
                      discountPct: String(discountPct),
                      shippingAddress: shippingAddress || undefined,
                      shippingDays:
                        Number.isFinite(shipDays) && shipDays > 0 ? shipDays : undefined,
                      shippingCost: shippingCost || undefined,
                      items,
                    }
                    updateMutation.mutate(
                      { id: numericPoId, input, rowVersion: poDetail.rowVersion },
                      { onSuccess: () => onNavigate("purchase-order-detail") },
                    )
                  }}
                >
                  {updateMutation.isPending ? "Menyimpan..." : "Simpan"}
                </button>
              )}
            </div>
          </div>

          <div className="flex w-full items-start">
            {steps.map((s, i) => {
              const isActive = i === step - 1
              return (
                <div key={s.n} className="contents">
                  <div className="flex flex-col items-center gap-2">
                    <div
                      className={`flex h-10 w-[162px] items-center justify-center rounded-lg transition-all duration-300 ease-[ease] ${
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
                      key={`line-${i}`}
                      className="mt-5 h-0.5 flex-1 bg-[rgba(203,213,225,0.3)]"
                    />
                  )}
                </div>
              )
            })}
          </div>

          {step === 1 && (
            <Step1Client
              search={search}
              setSearch={setSearch}
              filteredClients={filteredClients}
              selectedClient={selectedClient}
              setSelectedClient={setSelectedClient}
              setShowClientAdd={setShowClientAdd}
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
              disabledStyle={disabledStyle}
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
