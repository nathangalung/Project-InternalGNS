import { useEffect, useState } from "react"
import NavTrail from "@/components/shared/NavTrail"
import { useMe } from "@/features/auth/hooks"
import ClientAdd from "@/features/clients/ClientAdd"
import { pickedContact } from "@/features/clients/clientCard"
import ProductAdd from "@/features/items/ProductAdd"
import { useCreateQuotation } from "@/features/quotations/hooks"
import { useUnits } from "@/features/units/hooks"
import { resolveUnit } from "@/features/units/match"
import { useNavTrail } from "@/hooks/useNavTrail"
import { formatNumber as formatRp } from "@/lib/format"
import { listCrumb } from "@/lib/nav-trail"
import { canWriteCatalog, setsPrices } from "@/lib/rbac"
import { ui } from "@/lib/ui"
import type { QuotationCreateInput, QuotationItemInput } from "@/types/api"
import { toItemInput } from "./adapters"
import DiscountModal from "./DiscountModal"
import Step1Client from "./Step1Client"
import Step2Product from "./Step2Product"
import Step3Shipping from "./Step3Shipping"
import Step4Summary from "./Step4Summary"
import { useClientPicker } from "./useClientPicker"
import { useQuotationWizard } from "./useQuotationWizard"
import { WIZARD_STEPS as steps, validityInput } from "./wizard"
import { qe, stepLabel, stepNum, stepPill } from "./wizard-styles"
import { defaultContact, withContact } from "./wizardClient"

// Opened without a trail.
const fallback = [listCrumb("/quotations")]

export default function QuotationAdd() {
  const nav = useNavTrail(fallback)
  const { data: unitsData } = useUnits()
  // A role that sets no harga jual sees and sends none
  const role = useMe().data?.role
  const pricing = setsPrices(role)
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
    ppnEnabled,
    setPpnEnabled,
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
    unitByText,
    unitsOk,
    unknownUnits,
    invalidQty,
    qtyErrors,
    recordQtyFailure,
  } = useQuotationWizard(unitsData, pricing)

  // Client picking, add mode only.
  const [showClientAdd, setShowClientAdd] = useState(false)
  const { search, changeSearch, filteredClients, currentClient, contacts, clientsFailure, picker } =
    useClientPicker(selectedClient)
  const createQuotation = useCreateQuotation()
  const numericClientId = Number(selectedClient)

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
    return products.map((p) => toItemInput(p, resolveUnit(unitByText, p.satuan)?.id ?? 0, pricing))
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
      ppnEnabled: pricing ? ppnEnabled : undefined,
      shippingAddress: shippingAddress || undefined,
      shippingDays: Number.isFinite(shippingDays) && shippingDays > 0 ? shippingDays : undefined,
      shippingCost: shippingCost || undefined,
      items: buildItems(),
    }
    createQuotation.mutate(input, {
      onSuccess: () => nav.back(),
      onError: recordQtyFailure,
    })
  }

  const {
    totalProdukQty: summaryTotalProdukQty,
    totalHargaBeli: summaryTotalHargaBeli,
    total: summaryTotal,
    nominalDiskon,
    subTotal: summarySubTotal,
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
            <NavTrail current="Tambah Quotation" fallback={fallback} />
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
            picker={picker}
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
            pricing={pricing}
            products={products}
            unitByText={unitByText}
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
            summaryTotal={summaryTotal}
            nominalDiskon={nominalDiskon}
            summarySubTotal={summarySubTotal}
            summaryDpp={summaryDpp}
            summaryPpn={summaryPpn}
            summaryGrandTotal={summaryGrandTotal}
            withPPN={ppnEnabled}
            setWithPPN={pricing ? setPpnEnabled : undefined}
            onImportProducts={(newProds) => setProducts((prev) => [...prev, ...newProds])}
            qtyErrors={qtyErrors}
          />
        )}
        {step === 3 && (
          <Step3Shipping
            pricing={pricing}
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
            pricing={pricing}
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
            summaryTotal={summaryTotal}
            nominalDiskon={nominalDiskon}
            summarySubTotal={summarySubTotal}
            summaryDpp={summaryDpp}
            summaryPpn={summaryPpn}
            withPPN={ppnEnabled}
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
        pricing={pricing}
        open={showProductAdd}
        initialData={editingProduct}
        onOpenChange={setProductAddOpen}
        onSuccess={saveProduct}
        clientId={numericClientId > 0 ? numericClientId : undefined}
        allowIncomplete
        storeLinks={canWriteCatalog(role)}
      />
    </>
  )
}
