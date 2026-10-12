import { useMemo, useState } from "react"
import Modal from "@/components/shared/Modal"
import { useMe } from "@/features/auth/hooks"
import { getCompanyInitials } from "@/features/clients/helpers"
import StoreLinkModal from "@/features/items/StoreLinkModal"
import ClientChangeModal from "@/features/quotations/ClientChangeModal"
import ClientSummaryCard from "@/features/quotations/QuotationDetail/ClientSummaryCard"
import CostBreakdown from "@/features/quotations/QuotationDetail/CostBreakdown"
import ProductTable from "@/features/quotations/QuotationDetail/ProductTable"
import ShippingTable from "@/features/quotations/QuotationDetail/ShippingTable"
import type { ClientInfo, ProductRow } from "@/features/quotations/types"
import { useNavTrail } from "@/hooks/useNavTrail"
import { downloadFile, downloadPdf } from "@/lib/api-client"
import { formatDate, toNum } from "@/lib/format"
import { listCrumb } from "@/lib/nav-trail"
import { canWriteCatalog, managesPOs } from "@/lib/rbac"
import { toast } from "@/lib/toast"
import { ui } from "@/lib/ui"
import type { PoCompletenessIssue, PoTransition, PurchaseOrderRow } from "@/types/api"
import { poHistoryEntry, poItemsToProducts, poItemsToShipping, poRowFromBackend } from "../adapters"
import * as poApi from "../api"
import {
  useActorNames,
  useChangePoClient,
  useChangePoStatus,
  usePoHistory,
  usePoItems,
  usePoUpload,
  useRemovePoFile,
} from "../hooks"
import type { PoStatus } from "../types"
import UploadPoModal from "../UploadPoModal"
import CompletenessModal from "./CompletenessModal"
import DeliveryNoteModal from "./DeliveryNoteModal"
import FileCard from "./FileCard"
import FilePreviewModal from "./FilePreviewModal"
import Header from "./Header"
import HistoryCard from "./HistoryCard"
import {
  canDownloadDeliveryNote,
  completenessIssues,
  deliveryNoteFileName,
  poBreakdown,
  poClientEditable,
  poEditLockReason,
  poErrorMessage,
  previewKind,
  uploadRules,
} from "./helpers"
import ReasonModal from "./ReasonModal"
import StatusBar from "./StatusBar"

// Opened without a trail.
const fallback = [listCrumb("/purchase-orders")]

type PurchaseOrderDetailProps = {
  po: PurchaseOrderRow
  // The PO client's card, with its own narahubung
  clientInfo?: ClientInfo
  onEdit: () => void
}

export default function PurchaseOrderDetail({ po, clientInfo, onEdit }: PurchaseOrderDetailProps) {
  const nav = useNavTrail(fallback)
  const { data: me } = useMe()
  const { data: poItems } = usePoItems(po.id)
  const { data: events, isLoading: historyLoading } = usePoHistory(po.id)
  const actorNames = useActorNames(
    (events ?? []).map((ev) => ev.changedBy),
    me?.role === "superadmin",
  )
  const row = poRowFromBackend(po)
  const upload = usePoUpload(row)
  const changeStatus = useChangePoStatus()
  const removeFile = useRemovePoFile()

  // Pending choice, tied to the status it was made from
  const [choice, setChoice] = useState<{ from: PoStatus; t: PoTransition } | null>(null)
  const [showUpload, setShowUpload] = useState(false)
  const [showReason, setShowReason] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [showDnNotes, setShowDnNotes] = useState(false)
  // Line whose store link is being set
  const [linkRow, setLinkRow] = useState<ProductRow | null>(null)
  // The gate refusal and the move it stopped
  const [gate, setGate] = useState<{ issues: PoCompletenessIssue[]; target: string } | null>(null)

  // A saved move drops a stale choice.
  const selected = choice?.from === po.status ? choice.t : null

  const products = useMemo(() => poItemsToProducts(poItems), [poItems])
  const shipping = useMemo(() => poItemsToShipping(poItems), [poItems])
  // Profit needs real cost data.
  const hasCost = useMemo(() => (poItems ?? []).some((it) => toNum(it.costPrice) > 0), [poItems])
  // Figures the role may see came back; profit needs both sides
  const sellingShown = po.poGrandTotal !== undefined
  const profitShown = hasCost && po.poTotalProfit !== undefined
  // Heads run the PO; operational input only edits its purchase prices
  const writes = managesPOs(me?.role)
  const editsLines = canWriteCatalog(me?.role)
  const history = useMemo(
    () => (events ?? []).map((ev) => poHistoryEntry(ev, actorNames.get(ev.changedBy))),
    [events, actorNames],
  )

  const figures = poBreakdown(po)
  const totalShip = shipping.hargaSatuan
  const clientName = po.companyName
  // Heads move an open PO to another client of the holding.
  const clientEditable = writes && poClientEditable(po.status)
  const [changingClient, setChangingClient] = useState(false)
  const changeClient = useChangePoClient()

  async function saveClient(clientId: number, contactId: number | undefined) {
    try {
      await changeClient.mutateAsync({
        id: po.id,
        input: { clientId, contactId },
        rowVersion: po.rowVersion,
      })
    } catch (err) {
      return poErrorMessage(err, "Gagal mengganti klien PO.")
    }
    toast.success("Klien PO diganti.")
    setChangingClient(false)
    return null
  }

  // The gate's narahubung link.
  function changeContact() {
    setGate(null)
    setChangingClient(true)
  }
  const dnReady = canDownloadDeliveryNote(po)
  const editLockReason = poEditLockReason(po)
  const fileRemovable = po.status === "PENDING" || po.status === "UPLOADED"
  const hasFile = Boolean(po.objectKey && po.fileName)
  const rules = uploadRules(po.status, hasFile, upload.detailsLocked)

  async function applyStatus(t: PoTransition, note?: string) {
    try {
      await changeStatus.mutateAsync({ id: po.id, status: t.to, note })
      setShowReason(false)
      toast.success(`Status PO diubah menjadi ${t.label}.`)
      nav.back()
    } catch (err) {
      // The hook toasts everything but the completeness gate.
      const found = completenessIssues(err)
      if (found) {
        setShowReason(false)
        setGate({ issues: found, target: t.label })
      }
    }
  }

  function handleSave() {
    if (!selected) {
      nav.back()
      return
    }
    if (selected.requiresNote) {
      setShowReason(true)
      return
    }
    void applyStatus(selected)
  }

  async function handleUploadSubmit(
    file: File | null,
    details: { poNumber: string; poDate: string },
  ) {
    const result = await upload.save(file, details)
    if (result.saved) setShowUpload(false)
    return result.errors
  }

  // The gate's PO number link.
  function enterPoNumber() {
    setGate(null)
    setShowUpload(true)
  }

  async function handleRemoveFile() {
    try {
      await removeFile.mutateAsync(po.id)
      setConfirmRemove(false)
    } catch {
      // Hook toasts the error.
    }
  }

  async function handleDownload() {
    if (!po.objectKey || !po.fileName) return
    try {
      const { downloadUrl } = await poApi.presignDownload(po.id)
      await downloadFile(downloadUrl, po.fileName)
    } catch {
      toast.error("Gagal mengunduh berkas PO.")
    }
  }

  // dnReady guarantees the number.
  function downloadDeliveryNote() {
    return downloadPdf(
      `/purchase-orders/${po.id}/delivery-note.pdf`,
      deliveryNoteFileName(po.deliveryNoteNumber ?? ""),
    )
  }

  async function handleDownloadDeliveryNote() {
    try {
      await downloadDeliveryNote()
    } catch {
      toast.error("Gagal mengunduh Surat Jalan.")
    }
  }

  // The heads add row notes first; everyone else downloads directly.
  function startDeliveryNote() {
    if (writes && poItems) setShowDnNotes(true)
    else void handleDownloadDeliveryNote()
  }

  return (
    <>
      <div className={ui.pageContent}>
        <Header
          poNumber={po.poNumber}
          quotationId={po.quotationId}
          quotationNo={po.quotationNo}
          createdAt={formatDate(po.createdAt)}
          status={po.status}
          deliveryNoteNumber={po.deliveryNoteNumber}
          legacyDnNo={po.legacyDnNo}
          invoiceNo={po.invoiceNo}
          onEdit={!editsLines || editLockReason ? undefined : onEdit}
          editLockReason={editsLines ? (editLockReason ?? undefined) : undefined}
          onDownloadDeliveryNote={dnReady ? startDeliveryNote : undefined}
        />
        <StatusBar
          status={po.status}
          selected={selected}
          transitions={po.allowedTransitions}
          saving={changeStatus.isPending}
          onSelect={(t) => setChoice(t ? { from: po.status, t } : null)}
          onSave={handleSave}
        />
        <FileCard
          fileName={po.fileName}
          fileSize={po.fileSize}
          uploadedAt={po.uploadedAt}
          fileLocked={rules.fileLocked}
          onUpload={writes && rules.editable ? () => setShowUpload(true) : undefined}
          onDownload={() => void handleDownload()}
          onPreview={previewKind(po.fileName) === "none" ? undefined : () => setShowPreview(true)}
          onRemove={writes && fileRemovable ? () => setConfirmRemove(true) : undefined}
        />
        <ClientSummaryCard
          clientName={clientName}
          clientId={po.companyClientId}
          clientInitials={getCompanyInitials(clientName)}
          clientInfo={clientInfo}
          shippingAlamat={shipping.alamat}
          onChangeClient={clientEditable ? () => setChangingClient(true) : undefined}
        />
        {(sellingShown ? totalShip > 0 : Boolean(shipping.alamat || shipping.hari)) && (
          <div className="min-w-0 overflow-x-auto max-sm:*:min-w-max">
            <ShippingTable shipping={shipping} showPrice={sellingShown} />
          </div>
        )}
        <div className="min-w-0 overflow-x-auto max-sm:*:min-w-max">
          <ProductTable
            products={products}
            showProfit={profitShown}
            showPrices={sellingShown}
            showRequest={false}
            showVendor
            onEditStoreLink={editsLines ? setLinkRow : undefined}
          />
        </div>
        {sellingShown && (
          <CostBreakdown
            hasProducts={products.length > 0}
            total={figures.total}
            discountPct={figures.discountPct}
            nominalDiskon={figures.nominalDiskon}
            subTotal={figures.subTotal}
            dppNilaiLain={figures.dppNilaiLain}
            ppn12={figures.ppn12}
            withPPN={po.ppnEnabled}
            totalProfit={figures.totalProfit}
            showProfit={profitShown}
            grandTotal={figures.grandTotal}
          />
        )}
        <HistoryCard entries={history} isLoading={historyLoading} />
      </div>

      {showUpload && (
        <UploadPoModal
          row={row}
          hasExistingFile={hasFile}
          submitting={upload.isPending}
          detailsLocked={upload.detailsLocked}
          checking={upload.checking}
          onClose={() => setShowUpload(false)}
          onSubmit={handleUploadSubmit}
        />
      )}

      {showPreview && po.objectKey && po.fileName && (
        <FilePreviewModal
          poId={po.id}
          objectKey={po.objectKey}
          fileName={po.fileName}
          onDownload={() => void handleDownload()}
          onClose={() => setShowPreview(false)}
        />
      )}

      {linkRow?.itemId !== undefined && linkRow.vendorId !== undefined && (
        <StoreLinkModal
          itemId={linkRow.itemId}
          vendorId={linkRow.vendorId}
          vendorName={linkRow.vendor ?? ""}
          current={linkRow.productUrl}
          onClose={() => setLinkRow(null)}
        />
      )}

      {showReason && selected && (
        <ReasonModal
          statusLabel={selected.label}
          submitting={changeStatus.isPending}
          onClose={() => setShowReason(false)}
          onSubmit={(note) => void applyStatus(selected, note)}
        />
      )}

      {confirmRemove && (
        <Modal
          title="Hapus berkas PO?"
          onClose={() => setConfirmRemove(false)}
          footer={
            <>
              <button
                type="button"
                className={ui.modalCancel}
                onClick={() => setConfirmRemove(false)}
              >
                Batal
              </button>
              <button
                type="button"
                className={ui.modalSubmit}
                disabled={removeFile.isPending}
                onClick={() => void handleRemoveFile()}
              >
                {removeFile.isPending ? "Menghapus..." : "Hapus Berkas"}
              </button>
            </>
          }
        >
          <p className="m-0 pb-4 text-sm text-[#4A4455]">
            Berkas {po.fileName} akan dilepas dari PO ini dan status kembali menjadi Pending.
          </p>
        </Modal>
      )}

      {showDnNotes && poItems && (
        <DeliveryNoteModal
          poId={po.id}
          rowVersion={po.rowVersion}
          items={poItems}
          onDownload={downloadDeliveryNote}
          onClose={() => setShowDnNotes(false)}
        />
      )}

      {gate && (
        <CompletenessModal
          issues={gate.issues}
          target={gate.target}
          quotationId={po.quotationId}
          onClose={() => setGate(null)}
          onEnterPoNumber={writes && rules.editable ? enterPoNumber : undefined}
          onChangeContact={clientEditable ? changeContact : undefined}
        />
      )}

      {changingClient && (
        <ClientChangeModal
          clientId={po.companyClientId}
          contactId={po.contactId}
          allowSame
          note="Pilih perusahaan lain, misalnya dari grup usaha yang sama, atau narahubung lain. Quotation tetap atas nama klien semula. Setelah PO Dikirim, klien tidak dapat diganti."
          onSave={saveClient}
          onClose={() => setChangingClient(false)}
        />
      )}
    </>
  )
}
