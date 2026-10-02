import { Link, useNavigate } from "@tanstack/react-router"
import { useCallback, useEffect, useMemo, useRef } from "react"
import LoadingState from "@/components/shared/LoadingState"
import NotFoundState from "@/components/shared/NotFoundState"
import StateMessage from "@/components/shared/StateMessage"
import { useMe } from "@/features/auth/hooks"
import { clientCardInfo } from "@/features/clients/clientCard"
import { getCompanyInitials } from "@/features/clients/helpers"
import { useClient, useClientContacts } from "@/features/clients/hooks"
import ProductAdd from "@/features/items/ProductAdd"
import type { ProductAddFormData } from "@/features/items/ProductAdd/helpers"
import * as quotationsApi from "@/features/quotations/api"
import {
  useEditLocks,
  useLiveChange,
  useQuotation,
  useQuotationLive,
  useUpdateQuotationContact,
} from "@/features/quotations/hooks"
import { useUnits } from "@/features/units/hooks"
import { formatNumber as formatRp } from "@/lib/format"
import { ui } from "@/lib/ui"
import type { QuotationDetail } from "@/types/api"
import { toItemInput } from "./adapters"
import DiscountModal from "./DiscountModal"
import { HEADER_PART, headerInput, linePart, lockOwners, saveDraft } from "./live"
import Step1Client, { type Client } from "./Step1Client"
import Step2Product from "./Step2Product"
import Step3Shipping from "./Step3Shipping"
import Step4Summary from "./Step4Summary"
import { isEditable, quotationStatusLabel } from "./status"
import { useQuotationWizard } from "./useQuotationWizard"
import { type ProductItem, seedFromDetail, WIZARD_STEPS as steps, upsertProduct } from "./wizard"
import { qe, stepLabel, stepNum, stepPill } from "./wizard-styles"

type QuotationEditProps = {
  quotationId: string
}

// Who else holds the header
const headerNotice =
  "rounded-md border border-[rgba(245,158,11,0.3)] bg-[rgba(245,158,11,0.08)] px-3.5 py-2.5 text-xs font-medium text-[#92400E]"

const ignore = () => undefined

// Live edit of a saved draft.
//
// Every change is saved as it is made, so several users can work on one
// draft: a line or the header is claimed before it is edited, and a part
// another user holds is shown read-only with their name. The page follows
// the stored draft through the change stream; Simpan saves the header and
// the contact, then returns to the detail page.
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
    gates: { isAlamatOk, isWaktuFilled, isTenggatWaktuFilled },
    summary,
    unitIdByCode,
    unknownUnits,
    invalidQty,
    incompleteLines,
    seed,
    syncFromServer,
  } = useQuotationWizard(unitsData)

  const numericQuotationId = Number(quotationId)
  const hasNumericQuotationId = Number.isInteger(numericQuotationId) && numericQuotationId > 0
  const qid = hasNumericQuotationId ? numericQuotationId : undefined
  const { data: detail, isPending: isDetailPending } = useQuotation(qid)
  const updateContactMutation = useUpdateQuotationContact()
  const live = useLiveChange(qid)
  const locks = useEditLocks(qid)
  const { data: me } = useMe()
  const editable = detail ? isEditable(detail.status) : false
  useQuotationLive(editable ? qid : undefined, detail?.locks, me?.id)
  const owners = useMemo(() => lockOwners(detail?.locks ?? [], me?.id), [detail?.locks, me?.id])
  const holdsHeader = locks.holds(HEADER_PART)
  // Fetch contacts by quotation's own company, not selected client.
  const { data: contacts = [] } = useClientContacts(detail?.companyClientId)
  const { data: clientRow } = useClient(detail?.companyClientId)

  // The client is fixed on edit.
  //
  // The draft has no client edit, so a different pick would be dropped
  // silently. Step 1 shows the quotation's own client only; the summary
  // reads its live data and the contact picked in step 1.
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

  const toSeed = useCallback(
    (d: QuotationDetail) => seedFromDetail(d, unitNameById),
    [unitNameById],
  )

  // Seed once, then follow the server.
  //
  // The first load fills every step. Each later load (a change by anyone)
  // replaces the lines, and the header fields unless this user is editing
  // them; read through a ref so that releasing the header does not resync
  // from a load older than the save.
  const hydrated = useRef(false)
  const holdsHeaderRef = useRef(holdsHeader)
  holdsHeaderRef.current = holdsHeader
  useEffect(() => {
    if (!detail || !unitsData) return
    if (!hydrated.current) {
      hydrated.current = true
      seed(toSeed(detail))
      return
    }
    syncFromServer(toSeed(detail), !holdsHeaderRef.current)
  }, [detail, unitsData, seed, syncFromServer, toSeed])

  // The header steps claim the header.
  //
  // Quietly: when another user holds it the steps show their name instead,
  // and the claim is tried again once their hold ends.
  const onHeaderStep = step >= 3
  const { acquire, release } = locks
  // Set by Simpan, so the header freed on the way out is not claimed again.
  const leaving = useRef(false)
  useEffect(() => {
    if (!editable || !onHeaderStep || holdsHeader || owners.header || leaving.current) return
    void acquire(HEADER_PART, { quiet: true })
  }, [editable, onHeaderStep, holdsHeader, owners.header, acquire])

  const headerFields = {
    discountPct,
    shippingAddress,
    shippingTime,
    shippingCost,
    jatuhTempo,
    berlakuSampai,
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

  function goToDetail() {
    void navigate({ to: "/quotations/$id", params: { id: quotationId } })
  }

  // One live change; refusals toast in the hook.
  function change(run: () => Promise<unknown>): Promise<void> {
    return live.mutateAsync(run).then(ignore, ignore)
  }

  function lineInput(p: ProductItem) {
    return toItemInput(p, unitIdByCode.get(p.satuan.toUpperCase()) ?? 0)
  }

  // Claim a line, then open it.
  async function openLine(p: ProductItem) {
    if (!(await acquire(linePart(p.id)))) return
    setEditingProduct(p)
    setShowProductAdd(true)
  }

  // The line being saved keeps its claim until the save lands.
  const savingLine = useRef<number | null>(null)

  function saveLine(data: ProductAddFormData) {
    if (qid === undefined) return
    const editing = editingProduct
    const [line] = upsertProduct(editing ? [editing] : [], editing, data)
    if (!editing) {
      void change(() => quotationsApi.addLines(qid, [lineInput(line)]))
      return
    }
    savingLine.current = editing.id
    void change(() => quotationsApi.updateLine(qid, editing.id, lineInput(line))).finally(() => {
      savingLine.current = null
      void release(linePart(editing.id))
    })
  }

  // Closing unsaved frees the line.
  function setLineOpen(open: boolean) {
    if (!open && editingProduct && savingLine.current !== editingProduct.id) {
      void release(linePart(editingProduct.id))
    }
    setProductAddOpen(open)
  }

  // A discount opened from the product step claims the header for itself.
  const discountClaim = useRef(false)

  async function openDiscount() {
    if (!holdsHeader) {
      if (!(await acquire(HEADER_PART))) return
      discountClaim.current = true
    }
    setShowDiscountModal(true)
  }

  function closeDiscount(open: boolean) {
    setShowDiscountModal(open)
    if (open || !discountClaim.current) return
    discountClaim.current = false
    void release(HEADER_PART)
  }

  function saveDiscount(val: number) {
    const own = discountClaim.current
    discountClaim.current = false
    setShowDiscountModal(false)
    if (!detail || qid === undefined) return
    setDiscountPct(val)
    const input = headerInput(detail, { ...headerFields, discountPct: val })
    void change(() => quotationsApi.updateHeader(qid, input)).finally(() => {
      if (own) void release(HEADER_PART)
    })
  }

  function toggleLine(id: number) {
    const p = products.find((x) => x.id === id)
    if (!p || qid === undefined) return
    void change(() => quotationsApi.setLineOffer(qid, id, Boolean(p.noOffer)))
  }

  // Saved at once, so it asks first.
  function deleteLine(id: number) {
    if (qid === undefined || !confirm("Hapus produk ini dari quotation?")) return
    void change(() => quotationsApi.deleteLine(qid, id))
  }

  function importLines(lines: ProductItem[]) {
    if (qid === undefined || lines.length === 0) return
    void change(() => quotationsApi.addLines(qid, lines.map(lineInput)))
  }

  // The header needs a valid address and both terms before it is saved.
  const headerReady = isAlamatOk && isTenggatWaktuFilled
  const saving = live.isPending || updateContactMutation.isPending

  async function handleSave() {
    if (!detail || qid === undefined) return
    const input = headerInput(detail, headerFields)
    const saved = await saveDraft({
      holdsHeader,
      contactId: selectedContactId !== detail.contactId ? selectedContactId : undefined,
      acquireHeader: () => acquire(HEADER_PART),
      releaseHeader: () => release(HEADER_PART),
      saveHeader: () => live.mutateAsync(() => quotationsApi.updateHeader(qid, input)),
      saveContact: (contactId) => updateContactMutation.mutateAsync({ id: qid, contactId }),
    })
    if (!saved) return
    leaving.current = true
    // Leaving releases it too; this only frees it sooner.
    void release(HEADER_PART)
    goToDetail()
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
  if (!editable) {
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
                disabled={(holdsHeader && !headerReady) || saving}
                onClick={() => void handleSave()}
              >
                {saving ? "Menyimpan..." : "Simpan"}
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
        {(onHeaderStep || step === 1) && owners.header && (
          <div role="status" className={headerNotice}>
            Narahubung, pengiriman, tenggat waktu dan diskon sedang diubah oleh {owners.header}.
            Bagian ini dapat diubah lagi setelah selesai.
          </div>
        )}
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
            contactReadOnly={Boolean(owners.header)}
          />
        )}
        {step === 2 && (
          <Step2Product
            products={products}
            unitIdByCode={unitIdByCode}
            clientId={detail?.companyClientId}
            deleteProduct={deleteLine}
            toggleNoOffer={toggleLine}
            editProduct={(p) => void openLine(p)}
            lockedBy={owners.lines}
            setEditingProduct={setEditingProduct}
            setShowProductAdd={setShowProductAdd}
            prodPageSize={prodPageSize}
            setProdPageSize={setProdPageSize}
            prodPage={prodPage}
            setProdPage={setProdPage}
            isRowDropdownOpen={isRowDropdownOpen}
            setIsRowDropdownOpen={setIsRowDropdownOpen}
            setShowDiscountModal={(show) => (show ? void openDiscount() : closeDiscount(false))}
            discountPct={discountPct}
            formatRp={formatRp}
            summaryTotalHargaBeli={summaryTotalHargaBeli}
            summaryTotalHargaJual={summaryTotalHargaJual}
            nominalDiskon={nominalDiskon}
            summarySubTotal={summarySubTotal}
            summaryDpp={summaryDpp}
            summaryPpn={summaryPpn}
            onImportProducts={importLines}
            quotationId={numericQuotationId}
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
            readOnly={!holdsHeader}
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
            readOnly={!holdsHeader}
          />
        )}
      </div>

      {/* Modals */}
      <DiscountModal
        open={showDiscountModal}
        onOpenChange={closeDiscount}
        initialDiscount={discountPct}
        onSuccess={saveDiscount}
      />
      <ProductAdd
        open={showProductAdd}
        initialData={editingProduct}
        onOpenChange={setLineOpen}
        onSuccess={saveLine}
        clientId={detail?.companyClientId}
        allowIncomplete
      />
    </>
  )
}
