import { Link, useNavigate } from "@tanstack/react-router"
import { useCallback, useEffect, useMemo, useRef } from "react"
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
import { isVersionConflict } from "@/lib/errors"
import { formatNumber as formatRp } from "@/lib/format"
import { ui } from "@/lib/ui"
import type { QuotationDetail, QuotationItemInput, QuotationUpdateInput } from "@/types/api"
import { toItemInput } from "./adapters"
import DiscountModal from "./DiscountModal"
import Step1Client, { type Client } from "./Step1Client"
import Step2Product from "./Step2Product"
import Step3Shipping from "./Step3Shipping"
import Step4Summary from "./Step4Summary"
import { isEditable, quotationStatusLabel } from "./status"
import { useQuotationWizard } from "./useQuotationWizard"
import { seedFromDetail, WIZARD_STEPS as steps } from "./wizard"
import { qe, stepLabel, stepNum, stepPill } from "./wizard-styles"

type QuotationEditProps = {
  quotationId: string
}

export default function QuotationEdit({ quotationId }: QuotationEditProps) {
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
    gates: { isAlamatOk, isWaktuFilled, isTenggatWaktuFilled, hasContent },
    summary,
    unitIdByCode,
    unitsOk,
    unknownUnits,
    invalidQty,
    qtyErrors,
    recordQtyFailure,
    seed,
  } = useQuotationWizard(unitsData)

  const numericQuotationId = Number(quotationId)
  const hasNumericQuotationId = Number.isInteger(numericQuotationId) && numericQuotationId > 0
  const {
    data: detail,
    isPending: isDetailPending,
    refetch: refetchDetail,
  } = useQuotation(hasNumericQuotationId ? numericQuotationId : undefined)
  const updateMutation = useUpdateQuotation()
  const updateContactMutation = useUpdateQuotationContact()
  // Fetch contacts by quotation's own company, not selected client.
  const { data: contacts = [] } = useClientContacts(detail?.companyClientId)
  const { data: clientRow } = useClient(detail?.companyClientId)

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

  // Blocks save on units, qty, address.
  const canSave = products.length > 0 && invalidQty === 0 && unitsOk && isAlamatOk

  // Seed steps from a quotation.
  // A reseed after a save conflict also drops what the other user removed.
  const hydrate = useCallback(
    (d: QuotationDetail) => seed(seedFromDetail(d, unitNameById)),
    [seed, unitNameById],
  )

  // Wizard state is seeded once, after both the quotation and the units it
  // needs to resolve unit codes have arrived. Any later refetch of the same
  // quotation leaves entered steps alone; the route keys this component by id,
  // so a different quotation remounts and seeds again. A save conflict reseeds
  // explicitly.
  const hydrated = useRef(false)
  useEffect(() => {
    if (hydrated.current || !detail || !unitsData) return
    hydrated.current = true
    hydrate(detail)
  }, [detail, unitsData, hydrate])

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

  function goToDetail() {
    void navigate({ to: "/quotations/$id", params: { id: quotationId } })
  }

  // Someone saved first: reload theirs.
  //
  // Saving the stale wizard with the fresh rowVersion would silently
  // overwrite their change, so every step is reseeded from the stored row.
  async function reloadAfterConflict() {
    const fresh = await refetchDetail()
    if (!fresh.data) return
    hydrate(fresh.data)
    setStep(1)
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
        onError: (err) => {
          if (isVersionConflict(err)) {
            void reloadAfterConflict()
            return
          }
          recordQtyFailure(err)
        },
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
            unitIdByCode={unitIdByCode}
            clientId={detail?.companyClientId}
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
            isAlamatOk={isAlamatOk}
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
      <ProductAdd
        open={showProductAdd}
        initialData={editingProduct}
        onOpenChange={setProductAddOpen}
        onSuccess={saveProduct}
        clientId={detail?.companyClientId}
        allowIncomplete
      />
    </>
  )
}
