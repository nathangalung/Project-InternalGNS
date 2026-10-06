import { useNavigate } from "@tanstack/react-router"
import { useEffect, useMemo, useState } from "react"
import ClientAdd from "@/features/clients/ClientAdd"
import { pickedContact } from "@/features/clients/clientCard"
import { dedupeByCompany, fromClientHit, fromClientRow } from "@/features/clients/helpers"
import { useClient, useClientContacts, useClientSearch, useClients } from "@/features/clients/hooks"
import ProductAdd from "@/features/items/ProductAdd"
import { useCreateQuotation } from "@/features/quotations/hooks"
import { useUnits } from "@/features/units/hooks"
import { useDebouncedValue } from "@/hooks/useDebouncedValue"
import { formatNumber as formatRp } from "@/lib/format"
import { lookupFailure } from "@/lib/lookup"
import { INLINE_LOOKUP } from "@/lib/query-client"
import { ui } from "@/lib/ui"
import type { QuotationCreateInput, QuotationItemInput } from "@/types/api"
import { toItemInput } from "./adapters"
import DiscountModal from "./DiscountModal"
import Step1Client from "./Step1Client"
import Step2Product from "./Step2Product"
import Step3Shipping from "./Step3Shipping"
import Step4Summary from "./Step4Summary"
import { useQuotationWizard } from "./useQuotationWizard"
import { WIZARD_STEPS as steps, validityInput } from "./wizard"
import { qe, stepLabel, stepNum, stepPill } from "./wizard-styles"
import {
  defaultContact,
  PICKER_PAGE_SIZE,
  type PickClient,
  pickerWindow,
  resolveClient,
  visibleClients,
  withContact,
} from "./wizardClient"

export default function QuotationAdd() {
  const navigate = useNavigate()
  const { data: unitsData } = useUnits()
  const {
    step,
    setStep,
    isNextDisabled,
    selectedClient,
    setSelectedClient,
    selectedContactId,
    setSelectedContactId,
    showProductAdd,
    setShowProductAdd,
    setProductAddOpen,
    editingProduct,
    setEditingProduct,
    showDiscountModal,
    setShowDiscountModal,
    discountPct,
    setDiscountPct,
    products,
    setProducts,
    deleteProduct,
    toggleNoOffer,
    incompleteLines,
    saveProduct,
    prodPageSize,
    setProdPageSize,
    prodPage,
    setProdPage,
    isRowDropdownOpen,
    setIsRowDropdownOpen,
    shippingAddress,
    setShippingAddress,
    shippingTime,
    setShippingTime,
    shippingCost,
    setShippingCost,
    jatuhTempo,
    setJatuhTempo,
    berlakuSampai,
    setBerlakuSampai,
    clientRefNo,
    setClientRefNo,
    gates: { isAlamatOk, isWaktuFilled, isTenggatWaktuFilled, hasContent },
    summary,
    unitIdByCode,
    unitsOk,
    unknownUnits,
    invalidQty,
    qtyErrors,
    recordQtyFailure,
  } = useQuotationWizard(unitsData)

  // Client picking, add mode only.
  const [search, setSearch] = useState("")
  const [showClientAdd, setShowClientAdd] = useState(false)

  const trimmedSearch = search.trim()
  const debouncedSearch = useDebouncedValue(trimmedSearch, 250)
  // Search hits are active only; the first page must match. A failure shows
  // on the client step, never on the route error boundary, which would
  // discard every line already added.
  // Every active client, a page at a time by name; a search pages its hits.
  const [pickerPageNo, setPickerPageNo] = useState(1)
  // A new search starts on page 1
  const changeSearch = (s: string) => {
    setSearch(s)
    setPickerPageNo(1)
  }
  const clientsQuery = useClients(
    {
      limit: PICKER_PAGE_SIZE,
      offset: (pickerPageNo - 1) * PICKER_PAGE_SIZE,
      isActive: true,
      sortBy: "name",
      sortDir: "asc",
    },
    INLINE_LOOKUP,
  )
  const searchQuery = useClientSearch(debouncedSearch, { limit: 50 }, INLINE_LOOKUP)
  const clientsData = clientsQuery.data
  const searchHits = searchQuery.data
  const createQuotation = useCreateQuotation()

  const numericClientId = Number(selectedClient)
  const { data: contacts = [] } = useClientContacts(
    numericClientId > 0 ? numericClientId : undefined,
  )

  const remoteClients: PickClient[] = useMemo(() => {
    if (debouncedSearch.length > 0) {
      return dedupeByCompany(searchHits ?? []).map(fromClientHit)
    }
    return (clientsData?.rows ?? []).map(fromClientRow)
  }, [debouncedSearch, searchHits, clientsData])

  // A selection outside the picker is fetched by id.
  const isListed = remoteClients.some((c) => c.id === selectedClient)
  const selectedQuery = useClient(
    !isListed && numericClientId > 0 ? numericClientId : undefined,
    INLINE_LOOKUP,
  )
  const selectedRow = selectedQuery.data
  const clientsFailure = lookupFailure(
    debouncedSearch.length > 0 ? searchQuery : clientsQuery,
    selectedQuery,
  )
  const currentClient = useMemo(
    () => resolveClient(remoteClients, selectedClient, selectedRow),
    [remoteClients, selectedClient, selectedRow],
  )

  // The server pages the full list; search hits page here.
  const searching = debouncedSearch.length > 0
  const sortedClients = [...remoteClients].sort((a, b) => a.name.localeCompare(b.name, "id"))
  const pickerTotal = searching ? sortedClients.length : (clientsData?.total ?? 0)
  const picker = pickerWindow(pickerTotal, pickerPageNo)
  const pageRows = searching
    ? sortedClients.slice(picker.start, picker.start + PICKER_PAGE_SIZE)
    : sortedClients
  // The picked client stays in view on any page.
  const filteredClients = visibleClients(pageRows, currentClient, PICKER_PAGE_SIZE + 1)

  // Auto-select contact when client or contacts list changes.
  const clientContactId = currentClient?.contactId
  useEffect(() => {
    setSelectedContactId(
      selectedClient ? defaultContact(contacts, selectedContactId, clientContactId) : undefined,
    )
  }, [selectedClient, contacts, selectedContactId, clientContactId, setSelectedContactId])

  // The summary names the picked contact, never the client's first one.
  const picked = pickedContact(contacts, selectedContactId)
  const summaryClient = currentClient ? withContact(currentClient, picked) : undefined
  // A listed contact with no channel is completed in step 1 first; one not
  // loaded yet never flickers the button.
  const contactUnreachable = step === 1 && picked !== undefined && !picked.email && !picked.phone

  const canSubmit =
    Number.isFinite(numericClientId) &&
    numericClientId > 0 &&
    products.length > 0 &&
    invalidQty === 0 &&
    unitsOk &&
    isTenggatWaktuFilled &&
    hasContent &&
    isAlamatOk

  function buildItems(): QuotationItemInput[] {
    return products.map((p) => toItemInput(p, unitIdByCode.get(p.satuan.toUpperCase()) ?? 0))
  }

  function handleSubmit() {
    if (!canSubmit) return
    const shippingDays = Number(shippingTime)
    const input: QuotationCreateInput = {
      companyClientId: numericClientId,
      contactId: selectedContactId,
      clientRefNo: clientRefNo.trim() || undefined,
      paymentTerms: jatuhTempo.trim() ? `${jatuhTempo.trim()} days` : undefined,
      validityDays: validityInput(berlakuSampai),
      discountPct: String(discountPct),
      shippingAddress: shippingAddress || undefined,
      shippingDays: Number.isFinite(shippingDays) && shippingDays > 0 ? shippingDays : undefined,
      shippingCost: shippingCost || undefined,
      items: buildItems(),
    }
    createQuotation.mutate(input, {
      onSuccess: () => void navigate({ to: "/quotations" }),
      onError: recordQtyFailure,
    })
  }

  const {
    totalProdukQty: summaryTotalProdukQty,
    totalHargaBeli: summaryTotalHargaBeli,
    totalHargaJual: summaryTotalHargaJual,
    nominalDiskon,
    subTotal: summarySubTotal,
    shippingCost: summaryShippingCost,
    dpp: summaryDpp,
    ppn: summaryPpn,
    grandTotal: summaryGrandTotal,
    profit: summaryProfit,
  } = summary

  return (
    <>
      <div className={ui.pageContent}>
        {/* Header & Stepper */}
        <div className={qe.headerSection}>
          <div className={qe.headerLeft}>
            <nav className={`${ui.breadcrumb} flex-wrap`} aria-label="Breadcrumb">
              <button
                type="button"
                className={ui.breadcrumbLink}
                onClick={() => void navigate({ to: "/quotations" })}
              >
                Daftar Quotation
              </button>
              <span className={ui.breadcrumbSep} aria-hidden="true">
                &rsaquo;
              </span>
              <span className={ui.breadcrumbCurrent} aria-current="page">
                Tambah Quotation
              </span>
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
                disabled={isNextDisabled || contactUnreachable}
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
                className={`${qe.submit} w-[180px]`}
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
            setSearch={changeSearch}
            filteredClients={filteredClients}
            picker={{ ...picker, total: pickerTotal, onPage: setPickerPageNo }}
            selectedClient={selectedClient}
            setSelectedClient={setSelectedClient}
            setShowClientAdd={setShowClientAdd}
            clientsFailure={clientsFailure}
            contacts={contacts}
            selectedContactId={selectedContactId}
            setSelectedContactId={setSelectedContactId}
          />
        )}
        {step === 2 && (
          <Step2Product
            products={products}
            unitIdByCode={unitIdByCode}
            clientId={numericClientId > 0 ? numericClientId : undefined}
            deleteProduct={deleteProduct}
            toggleNoOffer={toggleNoOffer}
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
            isAlamatOk={isAlamatOk}
            isWaktuFilled={isWaktuFilled}
            formatRp={formatRp}
          />
        )}
        {step === 4 && (
          <Step4Summary
            terms={{
              jatuhTempo,
              setJatuhTempo,
              berlakuSampai,
              setBerlakuSampai,
              clientRefNo,
              setClientRefNo,
            }}
            currentClient={summaryClient}
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
            unknownUnitCount={unknownUnits}
            incompleteCount={incompleteLines}
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
      <ClientAdd
        open={showClientAdd}
        onOpenChange={setShowClientAdd}
        onSuccess={(_, created) => {
          // Select the new client, not just close.
          setSelectedClient(String(created.id))
          setShowClientAdd(false)
          setStep(2)
        }}
      />
      <ProductAdd
        open={showProductAdd}
        initialData={editingProduct}
        onOpenChange={setProductAddOpen}
        onSuccess={saveProduct}
        clientId={numericClientId > 0 ? numericClientId : undefined}
        allowIncomplete
      />
    </>
  )
}
